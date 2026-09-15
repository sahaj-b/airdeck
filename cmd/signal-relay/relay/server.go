package relay

import (
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// Only this join-page origin may open guest signaling sockets.
const prodGuestOrigin = "https://airdeck.sahaj.dev"

// Server is /health plus the two signaling sockets.
type Server struct {
	hub            *Hub
	allowLocalhost bool
	hostUpgrader   websocket.Upgrader
	guestUpgrader  websocket.Upgrader
}

// NewServer builds the routes for one hub.
func NewServer(hub *Hub, allowLocalhost bool) *Server {
	s := &Server{hub: hub, allowLocalhost: allowLocalhost}
	s.hostUpgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096}
	s.guestUpgrader = websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool { return s.checkGuestOrigin(r) },
	}
	return s
}

// checkGuestOrigin enforces the join-page allowlist; empty Origin passes.
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
func allowGet(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if !allowGet(w, r) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		if !allowGet(w, r) {
			return
		}
		conn, err := s.hostUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		s.hub.serveHost(conn, remoteIP(r.RemoteAddr))
	})
	mux.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		if !allowGet(w, r) {
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
