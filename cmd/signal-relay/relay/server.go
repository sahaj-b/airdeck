package relay

import (
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"
)

// Only this join-page origin may open guest signaling sockets. Extra
// preview origins join the allowlist via --guest-origins.
const prodGuestOrigin = "https://airdeck.sahaj.dev"

// Server is /health plus the two signaling sockets.
type Server struct {
	hub            *Hub
	allowLocalhost bool
	extraOrigins   []string
	hostUpgrader   websocket.Upgrader
	guestUpgrader  websocket.Upgrader
}

// NewServer builds the routes for one hub. extraOrigins allowlists
// additional exact join-page origins (Pages preview deployments) next to
// the production origin; entries are normalized to scheme://host.
func NewServer(hub *Hub, allowLocalhost bool, extraOrigins ...string) *Server {
	s := &Server{
		hub:            hub,
		allowLocalhost: allowLocalhost,
		extraOrigins:   normalizeOrigins(extraOrigins),
	}
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
	for _, extra := range s.extraOrigins {
		if strings.EqualFold(origin, extra) {
			return true
		}
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

// normalizeOrigins trims comma-separated origin entries down to
// scheme://host, dropping empties and anything that is not an http(s)
// origin. Browser Origin headers carry no path, so neither does the list.
func normalizeOrigins(raw []string) []string {
	var out []string
	for _, item := range raw {
		entry := strings.TrimSpace(item)
		if entry == "" {
			continue
		}
		parsed, err := url.Parse(entry)
		if err != nil {
			continue
		}
		parsed.Scheme = strings.ToLower(parsed.Scheme)
		host := strings.ToLower(parsed.Hostname())
		if (parsed.Scheme != "http" && parsed.Scheme != "https") || host == "" {
			continue
		}
		if port := parsed.Port(); port != "" {
			host += ":" + port
		}
		out = append(out, parsed.Scheme+"://"+host)
	}
	return out
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
