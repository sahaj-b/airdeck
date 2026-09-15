package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/online"
	"github.com/sahaj-b/airdeck/internal/rtc"
	"github.com/sahaj-b/airdeck/internal/rtchost"
	"github.com/sahaj-b/airdeck/internal/session"
)

// flipRelay answers /health and one /register with registered (empty ICE
// bundle) or conflict, depending on the flag.
func flipRelay(t *testing.T, conflict bool) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_, _, err = conn.ReadMessage()
		if err != nil {
			return
		}
		if conflict {
			_ = conn.WriteJSON(rtc.Conflict{Type: rtc.MessageConflict, Reason: "room code is claimed by another installation"})
			return
		}
		_ = conn.WriteJSON(rtc.Registered{Type: rtc.MessageRegistered, RoomCode: "TEST22", ICEServers: []rtc.ICEServer{}})
		// Hold the socket so the agent stays registered for the test.
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func freshLayouts(t *testing.T) *layout.Library {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	return library
}

func flipAgent(t *testing.T, sess *session.Session, relay *httptest.Server, lanOnly bool) *online.Agent {
	t.Helper()
	handler := input.NewHandler(sess)
	peers := rtchost.New(sess, handler, freshLayouts(t), 60)
	agent := online.New(online.Options{
		InstallationKey: "test-key", LanOnly: lanOnly,
		RelayURL: "ws" + strings.TrimPrefix(relay.URL, "http") + "/register",
		Session:  sess, Peers: peers,
	})
	t.Cleanup(agent.Close)
	return agent
}

func waitAgent(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestAdvertisedJoinURLFlipsOnlineWhenReachable(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()

	lan := server.AdvertisedJoinURL()
	if !strings.HasPrefix(lan, "http://") || !strings.Contains(lan, "/join?code="+sess.Code()) {
		t.Fatalf("offline join URL = %q, want LAN /join?code=", lan)
	}
	if got := server.OnlineJoinURL(); got != online.OnlineJoinURL(sess.Code()) {
		t.Fatalf("online join URL = %q", got)
	}

	relay := flipRelay(t, false)
	agent := flipAgent(t, sess, relay, false)
	server.SetOnline(agent)
	agent.Start()
	waitAgent(t, "reachable", agent.Reachable)
	advertised := server.AdvertisedJoinURL()
	if advertised != online.OnlineJoinURL(sess.Code()) {
		t.Fatalf("reachable join URL = %q, want %q", advertised, online.OnlineJoinURL(sess.Code()))
	}
	state := server.currentState()
	if !state.CentralReachable || state.ClaimConflict != "" {
		t.Fatalf("admin state = %+v, want reachable without conflict", state)
	}
	if state.OnlineJoinURL != online.OnlineJoinURL(sess.Code()) {
		t.Fatalf("admin onlineJoinURL = %q", state.OnlineJoinURL)
	}
}

// TestAdvertisedJoinURLFallsBackOnConflict: a claimed-elsewhere code
// keeps serving LAN while remote stays dark.
func TestAdvertisedJoinURLFallsBackOnConflict(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()

	relay := flipRelay(t, true)
	agent := flipAgent(t, sess, relay, false)
	server.SetOnline(agent)
	agent.Start()
	waitAgent(t, "conflict", func() bool { return agent.Conflict() != "" })
	advertised := server.AdvertisedJoinURL()
	if !strings.HasPrefix(advertised, "http://") || !strings.Contains(advertised, "/join?code="+sess.Code()) {
		t.Fatalf("conflicted join URL = %q, want LAN fallback with local code", advertised)
	}
	if state := server.currentState(); state.ClaimConflict == "" {
		t.Fatalf("admin state = %+v, want claim conflict", state)
	}
}

// TestLanOnlyAgentKeepsLANURL: lanOnly forces offline without probing,
// so the QR never flips and no socket opens.
func TestLanOnlyAgentKeepsLANURL(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	relay := flipRelay(t, false)
	agent := flipAgent(t, sess, relay, true)
	server.SetOnline(agent)
	agent.Start()
	time.Sleep(200 * time.Millisecond)
	if agent.Reachable() {
		t.Fatal("lanOnly agent reports reachable")
	}
	if advertised := server.AdvertisedJoinURL(); !strings.HasPrefix(advertised, "http://") {
		t.Fatalf("lanOnly join URL = %q, want LAN", advertised)
	}
}
