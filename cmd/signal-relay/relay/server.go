package relay

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// Join-page origin allowed to open guest signaling sockets. Browsers do
// not enforce same-origin on WebSocket, so without this check any web
// page could script joins against a victim's relay.
const prodGuestOrigin = "https://airdeck.sahaj.dev"

// Server is the relay HTTP surface: /health plus the two signaling
// sockets. Host registration skips the Origin check (no browser Origin);
// guest joins enforce the join-page allowlist.
type Server struct {
	hub            *Hub
	allowLocalhost bool
	hostUpgrader   websocket.Upgrader
	guestUpgrader  websocket.Upgrader
}

// NewServer builds the routes for one hub. allowLocalhost admits
// http(s)://localhost, 127.0.0.1, and ::1 (any port) on /join for dev;
// production serves the join page origin only.
func NewServer(hub *Hub, allowLocalhost bool) *Server {
	s := &Server{hub: hub, allowLocalhost: allowLocalhost}
	s.hostUpgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096}
	s.guestUpgrader = websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool { return s.checkGuestOrigin(r) },
	}
	return s
}

// checkGuestOrigin mirrors the host's SameOrigin pattern but against a
// fixed allowlist: empty Origin (curl, tests, future origin-less native
// clients) passes, browsers must match the join page.
func (s *Server) checkGuestOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(origin, prodGuestOrigin) {
		return true
	}
	if !s.allowLocalhost {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := parsed.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// Routes exposes /health, /register, and /join.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		conn, err := s.hostUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		s.hub.serveHost(conn, remoteIP(r.RemoteAddr))
	})
	mux.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		conn, err := s.guestUpgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("relay: guest upgrade rejected (origin=%q)", r.Header.Get("Origin"))
			return
		}
		s.hub.serveGuest(conn)
	})
	return mux
}
