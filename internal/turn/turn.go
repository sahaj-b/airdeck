// Package turn builds the STUN+TURN iceServer bundle the signal relay
// serves in registered/joined/accepted (SPEC Q5, PLAN Phase 3).
//
// Credentials are throwaway 24h TTL mint responses fetched via the
// Cloudflare HTTP mint API once per ~20h and cached in relay memory:
// zero per-join API calls, no refresh flow. The mint endpoint below is the
// verified shape from the Cloudflare TURN docs
// (POST /v1/turn/keys/{id}/credentials/generate, Bearer secret,
// {"ttl":86400}); PLAN's draft string said generate-ice-servers, the docs
// say generate, docs win.
package turn

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/rtc"
)

const (
	// STUNURL is always served alongside TURN: without STUN the phone
	// gathers no srflx candidates and every open-mode join silently
	// degrades to relayed.
	STUNURL = "stun:stun.cloudflare.com:3478"
	// CredentialTTL is the requested credential lifetime in seconds (24h).
	CredentialTTL = 86400
	// RefreshInterval re-mints well before the 24h credential dies.
	RefreshInterval = 20 * time.Hour
	// MintEndpointFormat builds the Cloudflare credential mint URL.
	MintEndpointFormat = "https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate"
	// MintTimeout bounds one mint call so a slow API never stalls a join.
	MintTimeout = 10 * time.Second
)

// Provider serves the cached iceServer bundle. It never fails: a dead mint
// API falls back to the stale cache, and a relay started without TURN
// creds serves STUN-only so direct-LAN drills work with no internet.
type Provider struct {
	mu             sync.Mutex
	keyID          string
	secret         string
	endpointFormat string
	client         *http.Client
	cached         []rtc.ICEServer
	fetchedAt      time.Time
}

// New returns a provider for one Cloudflare TURN key. Empty keyID/secret
// means STUN-only (local drills, tests); nothing dials out until Servers
// finds the cache stale.
func New(keyID, secret string) *Provider {
	return &Provider{
		keyID:          keyID,
		secret:         secret,
		endpointFormat: MintEndpointFormat,
		client:         &http.Client{Timeout: MintTimeout},
	}
}

// Configured reports whether TURN minting is available. Unconfigured relays
// still serve STUN so the direct path keeps working.
func (p *Provider) Configured() bool {
	return p.keyID != "" && p.secret != ""
}

// STUNOnly is the no-credential bundle: STUN with no TURN entry.
func STUNOnly() []rtc.ICEServer {
	return []rtc.ICEServer{{URLs: []string{STUNURL}}}
}

// Servers returns the bundle for registered/joined/accepted. It mints at
// most once per RefreshInterval; concurrent joins share the cache.
func (p *Provider) Servers(ctx context.Context) []rtc.ICEServer {
	p.mu.Lock()
	fresh := !p.fetchedAt.IsZero() && time.Since(p.fetchedAt) < RefreshInterval
	cached := p.cached
	configured := p.Configured()
	p.mu.Unlock()
	if fresh && len(cached) > 0 {
		return cloneServers(cached)
	}
	if !configured {
		return STUNOnly()
	}
	servers, err := MintCredentials(ctx, p.client, fmt.Sprintf(p.endpointFormat, p.keyID), p.secret, CredentialTTL)
	if err != nil {
		log.Printf("relay: TURN mint failed, serving %s: %v", staleOrSTUN(cached), err)
		if len(cached) > 0 {
			return cloneServers(cached)
		}
		return STUNOnly()
	}
	p.mu.Lock()
	p.cached = servers
	p.fetchedAt = time.Now()
	p.mu.Unlock()
	return cloneServers(servers)
}

func staleOrSTUN(cached []rtc.ICEServer) string {
	if len(cached) > 0 {
		return "stale cache"
	}
	return "STUN-only"
}

func cloneServers(in []rtc.ICEServer) []rtc.ICEServer {
	out := make([]rtc.ICEServer, len(in))
	for i, server := range in {
		urls := make([]string, len(server.URLs))
		copy(urls, server.URLs)
		out[i] = rtc.ICEServer{URLs: urls, Username: server.Username, Credential: server.Credential}
	}
	return out
}

// mintResponse mirrors the Cloudflare generate response body.
type mintResponse struct {
	ICEServers struct {
		URLs       []string `json:"urls"`
		Username   string   `json:"username"`
		Credential string   `json:"credential"`
	} `json:"iceServers"`
}

// MintCredentials fetches one 24h TURN bundle from the Cloudflare API and
// splits the response into a STUN entry plus a TURN entry, matching the
// browser RTCConfiguration and pion ICEServer shapes. STUN is always
// present even if the response omits it.
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
	if minted.ICEServers.Username == "" || minted.ICEServers.Credential == "" || len(minted.ICEServers.URLs) == 0 {
		return nil, fmt.Errorf("TURN mint response missing iceServers")
	}
	return SplitMinted(minted.ICEServers.URLs, minted.ICEServers.Username, minted.ICEServers.Credential), nil
}

// SplitMinted splits one mint response URL list into a STUN-first bundle.
// Classification is by scheme so future Cloudflare URL additions land in
// the right entry without code changes.
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
	return []rtc.ICEServer{
		{URLs: stun},
		{URLs: turn, Username: username, Credential: credential},
	}
}

// MintOfflineHMAC builds a TURN username/password pair locally per the
// expired draft-uberti-behave-turn-rest scheme
// (username "<expiry>:<keyID>", password base64(HMAC-SHA1(secret,
// username))). This is the Phase 3 verification spike: if Cloudflare's
// TURN fleet accepts self-minted passwords the relay can drop the HTTP
// fetch entirely, wire unchanged either way. Until a live-credential test
// proves acceptance, the cached-API path above stays authoritative and
// this function is unused in production.
func MintOfflineHMAC(keyID, secret string, ttlSeconds int64) (username, password string) {
	expiry := time.Now().Unix() + ttlSeconds
	username = fmt.Sprintf("%d:%s", expiry, keyID)
	mac := hmac.New(sha1.New, []byte(secret))
	_, _ = mac.Write([]byte(username))
	return username, base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
