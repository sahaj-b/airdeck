// Package turn builds the STUN+TURN bundle the relay serves.
// Credentials are 24h TTL mints fetched via the Cloudflare HTTP API
// once per ~20h and cached; no per-join calls, no refresh flow.
package turn

import (
	"bytes"
	"context"
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
	// STUNURL is always served alongside TURN.
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

// Provider serves the cached bundle and never fails.
type Provider struct {
	mu             sync.Mutex
	keyID          string
	secret         string
	endpointFormat string
	client         *http.Client
	cached         []rtc.ICEServer
	fetchedAt      time.Time
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

// STUNOnly is the no-credential bundle: STUN with no TURN entry.
func STUNOnly() []rtc.ICEServer {
	return []rtc.ICEServer{{URLs: []string{STUNURL}}}
}

// Servers returns the bundle, minting at most once per RefreshInterval.
func (p *Provider) Servers(ctx context.Context) []rtc.ICEServer {
	p.mu.Lock()
	fresh := !p.fetchedAt.IsZero() && time.Since(p.fetchedAt) < RefreshInterval
	cached := p.cached
	keyID, secret, endpoint, client := p.keyID, p.secret, p.endpointFormat, p.client
	p.mu.Unlock()
	if fresh && len(cached) > 0 {
		return cloneServers(cached)
	}
	if keyID == "" || secret == "" {
		return STUNOnly()
	}
	servers, err := MintCredentials(ctx, client, fmt.Sprintf(endpoint, keyID), secret, CredentialTTL)
	if err != nil {
		fallback := "STUN-only"
		if len(cached) > 0 {
			fallback = "stale cache"
		}
		log.Printf("relay: TURN mint failed, serving %s: %v", fallback, err)
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

// MintCredentials fetches one 24h TURN bundle from the Cloudflare API.
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
