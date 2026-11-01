package turn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/rtc"
)

func TestCloudflareEndpointUsesICEBundleAPI(t *testing.T) {
	provider := New("key-id", "secret")
	want := "https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate-ice-servers"
	if provider.endpointFormat != want {
		t.Fatalf("Cloudflare endpoint = %q, want %q", provider.endpointFormat, want)
	}
}

func TestSTUNOnlyCarriesSTUN(t *testing.T) {
	servers := STUNOnly()
	if len(servers) != 1 || len(servers[0].URLs) != 1 || servers[0].URLs[0] != STUNURL {
		t.Fatalf("STUNOnly = %+v, want single %s entry", servers, STUNURL)
	}
	if servers[0].Username != "" || servers[0].Credential != "" {
		t.Fatalf("STUN entry must not carry credentials: %+v", servers[0])
	}
}

func mintServer(t *testing.T, hits *atomic.Int64, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit := hits.Add(1)
		if r.Method != http.MethodPost {
			t.Errorf("mint method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/v1/turn/keys/test-id/credentials/generate-ice-servers" {
			t.Errorf("mint path = %q, want Cloudflare ICE credential path", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-secret" {
			t.Errorf("mint auth = %q, want Bearer test-secret", auth)
		}
		var body struct {
			TTL int `json:"ttl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode mint body: %v", err)
		}
		if body.TTL != CredentialTTL {
			t.Errorf("mint ttl = %d, want %d", body.TTL, CredentialTTL)
		}
		w.WriteHeader(status)
		if status != http.StatusOK && status != http.StatusCreated {
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"iceServers": []any{
			map[string]any{"urls": []string{"stun:stun.cloudflare.com:3478"}},
			map[string]any{
				"urls":       []string{"turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"},
				"username":   fmt.Sprintf("expiry:%d", hit),
				"credential": "cred==",
			},
		}})
	}))
}

func testProvider(endpoint string) *Provider {
	p := New("test-id", "test-secret")
	p.endpointFormat = endpoint + "%s/credentials/generate-ice-servers"
	return p
}

func hasSTUN(t *testing.T, servers []rtc.ICEServer) {
	t.Helper()
	for _, s := range servers {
		for _, u := range s.URLs {
			if strings.HasPrefix(strings.ToLower(u), "stun:") {
				return
			}
		}
	}
	t.Fatal("iceServers carry no STUN entry")
}

func TestServersMintsFreshCredentialsForEachJoin(t *testing.T) {
	var hits atomic.Int64
	server := mintServer(t, &hits, http.StatusCreated)
	defer server.Close()
	p := testProvider(server.URL + "/v1/turn/keys/")
	ctx := context.Background()
	first := p.Servers(ctx)
	second := p.Servers(ctx)
	if hits.Load() != 2 {
		t.Fatalf("mint calls = %d, want one per join", hits.Load())
	}
	if len(first) != 2 || len(second) != 2 {
		t.Fatalf("bundle = %+v, want STUN + TURN entries", first)
	}
	if first[1].Username != "expiry:1" || second[1].Username != "expiry:2" || first[1].Credential != "cred==" {
		t.Fatalf("TURN entries = %+v then %+v, want unique credentials", first[1], second[1])
	}
	hasSTUN(t, first)
}

func TestServersFallsBackToStaticThenSTUN(t *testing.T) {
	var hits atomic.Int64
	server := mintServer(t, &hits, http.StatusServiceUnavailable)
	defer server.Close()
	p := testProvider(server.URL + "/v1/turn/keys/")
	staticURLs := []string{"turn:turn.example:3478?transport=udp"}
	p.SetStatic("shared-secret", staticURLs)
	got := p.Servers(context.Background())
	if len(got) != 2 || got[1].Username == "" {
		t.Fatalf("static fallback = %+v, want STUN + TURN", got)
	}
	if err := VerifyStatic("shared-secret", got[1].Username, got[1].Credential, time.Now()); err != nil {
		t.Fatalf("static fallback credential: %v", err)
	}

	fresh := New("test-id", "test-secret")
	fresh.endpointFormat = "http://127.0.0.1:1/%s"
	fresh.client = &http.Client{Timeout: 100 * time.Millisecond}
	if got := fresh.Servers(context.Background()); len(got) != 1 || got[0].URLs[0] != STUNURL {
		t.Fatalf("dead-mint serve = %+v, want STUN-only", got)
	}
}

func TestServersUnconfiguredIsSTUNOnly(t *testing.T) {
	if got := New("", "").Servers(context.Background()); len(got) != 1 {
		t.Fatalf("unconfigured serve = %+v, want STUN-only", got)
	}
}

func TestSplitMintedKeepsSTUNAlongsideTURN(t *testing.T) {
	servers := SplitMinted([]string{
		"stun:stun.cloudflare.com:3478",
		"turn:turn.cloudflare.com:3478?transport=udp",
		"turns:turn.cloudflare.com:443?transport=tcp",
	}, "user", "pass")
	if len(servers) != 2 {
		t.Fatalf("split = %+v, want 2 entries", servers)
	}
	for _, u := range servers[0].URLs {
		if !strings.HasPrefix(u, "stun:") {
			t.Fatalf("first entry carries non-STUN url %q", u)
		}
	}
	if servers[1].Username != "user" || servers[1].Credential != "pass" || len(servers[1].URLs) != 2 {
		t.Fatalf("TURN entry = %+v", servers[1])
	}
	if got := SplitMinted([]string{"turn:turn.cloudflare.com:3478"}, "u", "p"); got[0].URLs[0] != STUNURL {
		t.Fatalf("missing STUN was not backfilled: %+v", got)
	}
}

func TestStaticRoundTrip(t *testing.T) {
	now := time.Now()
	username, password, err := MintStatic("shared-secret", now, time.Duration(CredentialTTL)*time.Second)
	if err != nil {
		t.Fatalf("MintStatic: %v", err)
	}
	if err := VerifyStatic("shared-secret", username, password, now); err != nil {
		t.Fatalf("VerifyStatic fresh: %v", err)
	}
	// Wrong secret fails, so a relay/coturn secret mismatch surfaces here
	// instead of as silent relayed-path breakage.
	if err := VerifyStatic("other-secret", username, password, now); err == nil {
		t.Fatal("VerifyStatic accepted a wrong secret")
	}
	// Expiry is enforced: a credential outliving its TTL is rejected.
	if err := VerifyStatic("shared-secret", username, password, now.Add(time.Duration(CredentialTTL+1)*time.Second)); err == nil {
		t.Fatal("VerifyStatic accepted an expired credential")
	}
	// Garbage usernames fail instead of panicking the mint path.
	for _, bad := range []string{"", "no-colon", "abc:def"} {
		if err := VerifyStatic("shared-secret", bad, password, now); err == nil {
			t.Fatalf("VerifyStatic accepted username %q", bad)
		}
	}
	if _, _, err := MintStatic("", now, time.Hour); err == nil {
		t.Fatal("MintStatic accepted an empty secret")
	}
}

func TestStaticServersBundle(t *testing.T) {
	urls := []string{"turn:signal.example:3478?transport=udp", "turn:signal.example:3478?transport=tcp"}
	servers := staticServers("shared-secret", urls, time.Now())
	if len(servers) != 2 {
		t.Fatalf("static bundle = %+v, want STUN + TURN entries", servers)
	}
	hasSTUN(t, servers)
	if servers[1].Username == "" || servers[1].Credential == "" {
		t.Fatalf("TURN entry carries no credentials: %+v", servers[1])
	}
	if err := VerifyStatic("shared-secret", servers[1].Username, servers[1].Credential, time.Now()); err != nil {
		t.Fatalf("bundle credential does not verify: %v", err)
	}
	// Usernames are unique per call so two joins never share a credential.
	other := staticServers("shared-secret", urls, time.Now())
	if servers[1].Username == other[1].Username {
		t.Fatal("consecutive static mints share a username")
	}
}

func TestStaticPreferredWithoutCloudflare(t *testing.T) {
	p := NewStatic("shared-secret", []string{"turn:signal.example:3478?transport=udp"})
	got := p.Servers(context.Background())
	if len(got) != 2 || got[1].Username == "" {
		t.Fatalf("static serve = %+v, want STUN + TURN entries", got)
	}
	// SetStatic wires the same backend onto a Cloudflare provider without
	// touching New call sites.
	cloud := New("id", "secret")
	cloud.endpointFormat = "http://127.0.0.1:1/%s"
	cloud.client = &http.Client{Timeout: 100 * time.Millisecond}
	cloud.SetStatic("shared-secret", []string{"turn:signal.example:3478?transport=udp"})
	got = cloud.Servers(context.Background())
	if len(got) != 2 || got[1].Username == "" {
		t.Fatalf("cloudflare-down serve = %+v, want self-hosted fallback", got)
	}
}
