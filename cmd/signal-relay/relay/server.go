package relay

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
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
	trustedProxies []netip.Prefix
	hostUpgrader   websocket.Upgrader
	guestUpgrader  websocket.Upgrader
}

// loopbackProxies is the default trust list. Production runs the relay
// plain behind Caddy on the same host, so every guest socket arrives
// from 127.0.0.1 and the proxy's X-Forwarded-For decides the client.
var loopbackProxies = []netip.Prefix{
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("::1/128"),
}

// NewServer builds the routes for one hub. extraOrigins allowlists
// additional exact join-page origins (Pages preview deployments) next to
// the production origin; entries are normalized to scheme://host.
func NewServer(hub *Hub, allowLocalhost bool, extraOrigins ...string) *Server {
	s := &Server{
		hub:            hub,
		allowLocalhost: allowLocalhost,
		extraOrigins:   normalizeOrigins(extraOrigins),
		trustedProxies: loopbackProxies,
	}
	// Explicit origin policy for /register: native Go hosts send no
	// Origin header (allowed); browser hosts must be same-origin so a
	// foreign page cannot drive registration. This mirrors gorilla's
	// default but states the posture instead of inheriting it.
	s.hostUpgrader = websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true
			}
			return checkSameOrigin(r)
		},
	}
	s.guestUpgrader = websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool { return s.checkGuestOrigin(r) },
	}
	return s
}

func checkSameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	host := r.Host
	if host == "" {
		host = r.URL.Host
	}
	return strings.EqualFold(parsed.Host, host)
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

// SetTrustedProxies adds proxy hops whose X-Forwarded-For may name the
// real client for rate limiting. Loopback is always trusted (Caddy in
// front of the relay); entries here cover a proxy on another host. An
// empty list keeps the loopback default. Call before serving.
func (s *Server) SetTrustedProxies(entries []string) error {
	proxies, err := parseTrustedProxies(entries)
	if err != nil {
		return err
	}
	if len(proxies) == 0 {
		return nil
	}
	s.trustedProxies = append(append([]netip.Prefix{}, loopbackProxies...), proxies...)
	return nil
}

// parseTrustedProxies accepts bare IPs and CIDRs.
func parseTrustedProxies(entries []string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, entry := range entries {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(trimmed); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(trimmed)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy %q: want an IP or CIDR", trimmed)
		}
		addr = addr.Unmap()
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out, nil
}

func (s *Server) isTrustedProxy(addr netip.Addr) bool {
	for _, prefix := range s.trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// clientIP resolves the rate-limit identity for one request: the TCP
// peer, or the real client when that peer is a trusted proxy hop. Keying
// on a proxy hop would put every phone in one bucket, where a single
// guest in a rejoin loop exhausts the budget for the whole party.
func (s *Server) clientIP(r *http.Request) string {
	peer := remoteIP(r.RemoteAddr)
	addr, err := netip.ParseAddr(peer)
	if err != nil || !s.isTrustedProxy(addr.Unmap()) {
		return peer
	}
	// Right to left: the rightmost entry is appended by the trusted hop
	// closest to us, so anything a caller prepended sits to its left and
	// is never reached. Further trusted hops are skipped the same way.
	entries := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(entries) - 1; i >= 0; i-- {
		candidate, ok := parseForwardedAddr(entries[i])
		if !ok || s.isTrustedProxy(candidate) {
			continue
		}
		return candidate.String()
	}
	return peer
}

// parseForwardedAddr reads one X-Forwarded-For entry, tolerating the
// host:port form some proxies emit.
func parseForwardedAddr(raw string) (netip.Addr, bool) {
	entry := strings.TrimSpace(raw)
	if entry == "" {
		return netip.Addr{}, false
	}
	if host, _, err := net.SplitHostPort(entry); err == nil {
		entry = host
	}
	addr, err := netip.ParseAddr(entry)
	if err != nil {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}

// remoteIP strips the port for rate-limit keys.
func remoteIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
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
		s.hub.serveHost(conn, s.clientIP(r))
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
		s.hub.serveGuest(conn, s.clientIP(r))
	})
	return mux
}
