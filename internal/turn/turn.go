// Package turn builds the STUN+TURN bundle the relay serves.
//
// Two backends share one Servers call so the signaling wire never cares
// where credentials came from:
//   - Cloudflare: short-lived credentials minted once per joining player.
//   - Self-hosted (coturn): offline HMAC mint per joining player using the
//     TURN REST API scheme (username <expiry>:<id>, password
//     base64(HMAC-SHA1(secret, username))). The secret must match
//     coturn's static-auth-secret. Cheap enough to mint fresh every call,
//     so each join gets a full TTL instead of a stale-cache remainder.
//
// Backend priority: Cloudflare when its keys are set (better global
// network), else self-hosted when its secret plus URLs are set, else
// STUN-only. A Cloudflare mint failure falls back to self-hosted when
// configured, then STUN-only.
package turn

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/rtc"
)

const (
	// STUNURL is always served alongside TURN.
	STUNURL = "stun:stun.cloudflare.com:3478"
	// CredentialTTL is Cloudflare's maximum supported lifetime, in seconds.
	CredentialTTL = 48 * 60 * 60
	// MintEndpointFormat builds the Cloudflare ICE server credential URL.
	MintEndpointFormat = "https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate-ice-servers"
	// MintTimeout bounds one mint call so a slow API never stalls a join.
	MintTimeout = 10 * time.Second
)

// Provider mints TURN credentials and never fails.
type Provider struct {
	mu             sync.Mutex
	keyID          string
	secret         string
	endpointFormat string
	client         *http.Client
	staticSecret   string
	staticURLs     []string
	passUser       string
	passCred       string
	passURLs       []string
}

// New returns a provider for one Cloudflare TURN key.
func New(keyID, secret string) *Provider {
	return &Provider{
		keyID:          keyID,
		secret:         secret,
		endpointFormat: MintEndpointFormat,
		client:         &http.Client{Timeout: MintTimeout},
	}
}

// NewStatic returns a provider minting offline HMAC credentials for a
// self-hosted coturn. urls are the TURN urls (no STUN entry needed, it
// is prepended automatically). The secret must match coturn's
// static-auth-secret.
func NewStatic(secret string, urls []string) *Provider {
	return &Provider{
		staticSecret: secret,
		staticURLs:   append([]string(nil), urls...),
		client:       &http.Client{Timeout: MintTimeout},
	}
}

// SetStatic installs (or clears) the self-hosted backend on an existing
// provider. It lets main wire flags without new constructors at every
// call site: Cloudflare keys stay on New, coturn lands here.
func (p *Provider) SetStatic(secret string, urls []string) {
	p.mu.Lock()
	p.staticSecret = secret
	p.staticURLs = append([]string(nil), urls...)
	p.mu.Unlock()
}

// SetPassthrough installs (or clears) verbatim TURN credentials for testing.
// Unlike the HMAC backends it mints nothing: Servers returns passURLs with
// exactly this username/credential. It exists so a one-shot alternate relay
// (Metered OpenRelay API creds, ExpressTurn static creds, Xirsys trial)
// can be A/B tested without teaching the relay that vendor's mint protocol.
// Creds from time-limited APIs expire; refresh means resetting the flags.
func (p *Provider) SetPassthrough(username, credential string, urls []string) {
	p.mu.Lock()
	p.passUser = username
	p.passCred = credential
	p.passURLs = append([]string(nil), urls...)
	p.mu.Unlock()
}

// STUNOnly is the no-credential bundle: STUN with no TURN entry.
func STUNOnly() []rtc.ICEServer {
	return []rtc.ICEServer{{URLs: []string{STUNURL}}}
}

// Servers returns a fresh bundle for one joining player. TURN credentials
// are not shared across players, and reconnects get a new full TTL.
func (p *Provider) Servers(ctx context.Context) []rtc.ICEServer {
	p.mu.Lock()
	keyID, secret, endpoint, client := p.keyID, p.secret, p.endpointFormat, p.client
	staticSecret, staticURLs := p.staticSecret, append([]string(nil), p.staticURLs...)
	passUser, passCred, passURLs := p.passUser, p.passCred, append([]string(nil), p.passURLs...)
	p.mu.Unlock()
	// Explicit operator override for A/B tests: serve verbatim, mint nothing.
	if passUser != "" && passCred != "" && len(passURLs) > 0 {
		return SplitMinted(passURLs, passUser, passCred)
	}
	hasStatic := staticSecret != "" && len(staticURLs) > 0
	if keyID != "" && secret != "" {
		servers, err := MintCredentials(ctx, client, fmt.Sprintf(endpoint, keyID), secret, CredentialTTL)
		if err == nil {
			return servers
		}
		if hasStatic {
			log.Printf("relay: TURN mint failed, serving self-hosted: %v", err)
			return staticServers(staticSecret, staticURLs, time.Now())
		}
		log.Printf("relay: TURN mint failed, serving STUN-only: %v", err)
		return STUNOnly()
	}
	if hasStatic {
		return staticServers(staticSecret, staticURLs, time.Now())
	}
	return STUNOnly()
}

// mintResponse mirrors Cloudflare's array of ICE server entries.
type mintResponse struct {
	ICEServers []rtc.ICEServer `json:"iceServers"`
}

// MintCredentials fetches one TURN bundle from the Cloudflare API.
func MintCredentials(ctx context.Context, client *http.Client, endpoint, secret string, ttl int) ([]rtc.ICEServer, error) {
	body, err := json.Marshal(map[string]int{"ttl": ttl})
	if err != nil {
		return nil, fmt.Errorf("encode TURN mint request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build TURN mint request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("TURN mint request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("TURN mint status %s", resp.Status)
	}
	var minted mintResponse
	if err := json.NewDecoder(resp.Body).Decode(&minted); err != nil {
		return nil, fmt.Errorf("decode TURN mint response: %w", err)
	}
	return normalizeMinted(minted.ICEServers)
}

func normalizeMinted(entries []rtc.ICEServer) ([]rtc.ICEServer, error) {
	var stunURLs []string
	var turnServers []rtc.ICEServer
	for _, entry := range entries {
		var urls []string
		for _, url := range entry.URLs {
			switch {
			case strings.HasPrefix(strings.ToLower(url), "stun:"):
				stunURLs = append(stunURLs, url)
			case strings.HasPrefix(strings.ToLower(url), "turn:") || strings.HasPrefix(strings.ToLower(url), "turns:"):
				urls = append(urls, url)
			}
		}
		if len(urls) == 0 {
			continue
		}
		if entry.Username == "" || entry.Credential == "" {
			return nil, fmt.Errorf("TURN mint response has unauthenticated TURN URLs")
		}
		turnServers = append(turnServers, rtc.ICEServer{
			URLs:       urls,
			Username:   entry.Username,
			Credential: entry.Credential,
		})
	}
	if len(turnServers) == 0 {
		return nil, fmt.Errorf("TURN mint response missing TURN URLs")
	}
	if len(stunURLs) == 0 {
		stunURLs = []string{STUNURL}
	}
	servers := make([]rtc.ICEServer, 0, len(turnServers)+1)
	servers = append(servers, rtc.ICEServer{URLs: stunURLs})
	return append(servers, turnServers...), nil
}

// SplitMinted splits one mint response URL list into a STUN-first bundle.
func SplitMinted(urls []string, username, credential string) []rtc.ICEServer {
	var stun, turn []string
	for _, url := range urls {
		if strings.HasPrefix(strings.ToLower(url), "stun:") {
			stun = append(stun, url)
		} else {
			turn = append(turn, url)
		}
	}
	if len(stun) == 0 {
		stun = []string{STUNURL}
	}
	if len(turn) == 0 {
		return []rtc.ICEServer{{URLs: stun}}
	}
	return []rtc.ICEServer{
		{URLs: stun},
		{URLs: turn, Username: username, Credential: credential},
	}
}

// MintStatic mints one TURN REST API credential pair for a self-hosted
// server sharing secret. username is "<expiry>:<random>", password is
// base64(HMAC-SHA1(secret, username)), expiry is now+ttl. coturn with
// use-auth-secret plus the same static-auth-secret accepts it; the secret
// itself never leaves the relay.
func MintStatic(secret string, now time.Time, ttl time.Duration) (username, password string, err error) {
	if secret == "" {
		return "", "", fmt.Errorf("TURN static secret is empty")
	}
	if ttl <= 0 {
		return "", "", fmt.Errorf("TURN static ttl must be positive")
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return "", "", fmt.Errorf("TURN static random id: %w", err)
	}
	username = strconv.FormatInt(now.Add(ttl).Unix(), 10) + ":" + hex.EncodeToString(id)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, password, nil
}

// VerifyStatic checks a username/password pair against secret at time now.
// It exists for tests and for operators validating a coturn pairing
// without a live call; coturn itself rechecks on every allocation.
func VerifyStatic(secret, username, password string, now time.Time) error {
	if secret == "" {
		return fmt.Errorf("TURN static secret is empty")
	}
	expiry, _, ok := strings.Cut(username, ":")
	if !ok {
		return fmt.Errorf("TURN static username has no expiry prefix")
	}
	unix, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil {
		return fmt.Errorf("TURN static expiry is not numeric: %w", err)
	}
	if now.Unix() >= unix {
		return fmt.Errorf("TURN static credential is expired")
	}
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(password), []byte(want)) {
		return fmt.Errorf("TURN static password mismatch")
	}
	return nil
}

// staticServers mints one fresh credential pair and wraps it in the
// STUN-first bundle shape. A mint failure degrades to STUN-only rather
// than failing the join: direct candidates still work.
func staticServers(secret string, urls []string, now time.Time) []rtc.ICEServer {
	username, password, err := MintStatic(secret, now, time.Duration(CredentialTTL)*time.Second)
	if err != nil {
		log.Printf("relay: static TURN mint failed, serving STUN-only: %v", err)
		return STUNOnly()
	}
	return SplitMinted(urls, username, password)
}
