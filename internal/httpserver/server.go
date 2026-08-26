package httpserver

import (
	"context"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
)

type Options struct {
	Config     config.Config
	Session    *session.Session
	Input      *input.Handler
	Transport  *transport.Server
	Layouts    *layout.Library
	Static     fs.FS
	OnSettings func(config.Config) error
}

type Server struct {
	mu         sync.Mutex
	options    Options
	static     fs.FS
	public     *http.Server
	admin      *http.Server
	publicLn   net.Listener
	adminLn    net.Listener
	publicPort int
	adminPort  int
	adminWS    map[*websocket.Conn]struct{}
}

type listenerSet struct {
	public     *http.Server
	admin      *http.Server
	publicLn   net.Listener
	adminLn    net.Listener
	publicPort int
	adminPort  int
}

func New(options Options) *Server {
	static, err := fs.Sub(options.Static, "dist")
	if err != nil {
		static = options.Static
	}
	return &Server{options: options, static: static, adminWS: make(map[*websocket.Conn]struct{})}
}

func (s *Server) buildListenerSet(cfg config.Config) (listenerSet, error) {
	publicLn, publicPort, err := listenWithFallback(optionsBind(cfg.Bind), cfg.Port)
	if err != nil {
		return listenerSet{}, fmt.Errorf("listen public HTTP server: %w", err)
	}
	set := listenerSet{public: &http.Server{Handler: s.routes(false)}, publicLn: publicLn, publicPort: publicPort, adminPort: publicPort}
	if isLoopbackBind(cfg.Bind) {
		return set, nil
	}
	// Non-loopback bind: start a loopback admin listener so the host can
	// always reach the dashboard. Prefer the public port number so the
	// dashboard URL stays stable; fall back to an ephemeral port.
	adminLn, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(publicPort)))
	if err != nil {
		adminLn, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			_ = publicLn.Close()
			return listenerSet{}, fmt.Errorf("listen loopback admin server: %w", err)
		}
	}
	set.admin = &http.Server{Handler: s.routes(true)}
	set.adminLn = adminLn
	set.adminPort = adminLn.Addr().(*net.TCPAddr).Port
	return set, nil
}

func (s *Server) installListenerSet(cfg config.Config, set listenerSet) {
	s.options.Config = cfg
	s.public, s.admin = set.public, set.admin
	s.publicLn, s.adminLn = set.publicLn, set.adminLn
	s.publicPort, s.adminPort = set.publicPort, set.adminPort
}

func serveListenerSet(set listenerSet) {
	go func() { _ = set.public.Serve(set.publicLn) }()
	if set.admin != nil {
		go func() { _ = set.admin.Serve(set.adminLn) }()
	}
}

func shutdownListenerSet(ctx context.Context, set listenerSet) error {
	// Close the listeners synchronously so new connections stop being
	// accepted. The servers then drain in the background: a rebind can be
	// triggered from a settings handler on the very server being replaced,
	// and http.Server.Shutdown waits for active connections to go idle, which
	// includes that handler. Existing WebSocket connections are owned by
	// their handlers and survive the listener close, so phones keep playing.
	if set.publicLn != nil {
		_ = set.publicLn.Close()
	}
	if set.adminLn != nil {
		_ = set.adminLn.Close()
	}
	if set.public != nil {
		go func() { _ = set.public.Shutdown(ctx) }()
	}
	if set.admin != nil {
		go func() { _ = set.admin.Shutdown(ctx) }()
	}
	return nil
}

func (s *Server) Start() error {
	s.mu.Lock()
	if s.publicLn != nil {
		s.mu.Unlock()
		return fmt.Errorf("HTTP server is already running")
	}
	cfg := s.options.Config
	set, err := s.buildListenerSet(cfg)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	s.installListenerSet(cfg, set)
	s.mu.Unlock()
	serveListenerSet(set)
	return nil
}

func optionsBind(bind string) string {
	if bind == "" {
		return "0.0.0.0"
	}
	return bind
}

func listenWithFallback(bind string, requested int) (net.Listener, int, error) {
	if requested == 0 {
		requested = 6969
	}
	var last error
	for port := requested; port <= 65535; port++ {
		listener, err := net.Listen("tcp", net.JoinHostPort(bind, strconv.Itoa(port)))
		if err == nil {
			return listener, port, nil
		}
		last = err
		if port-requested >= 100 {
			break
		}
	}
	return nil, 0, last
}

func isLoopbackBind(bind string) bool {
	switch bind {
	case "", "0.0.0.0", "::", "127.0.0.1", "::1":
		return true
	}
	return strings.EqualFold(bind, "localhost")
}

func (s *Server) AdvertisedJoinURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	host := s.options.Config.AdvertisedHost
	if host == "" {
		host = defaultAdvertisedHost()
	}
	port := s.options.Config.AdvertisedPort
	if port == 0 {
		port = s.publicPort
	}
	return advertisedURL(host, port, s.options.Session.Code())
}

func defaultAdvertisedHost() string {
	// Pick the interface holding the default route so the QR actually works
	// on the LAN without the host having to configure it manually.
	iface, err := defaultRouteInterface()
	if err == nil && iface != "" {
		if ip := interfaceIPv4(iface); ip != "" {
			return ip
		}
	}
	// Fallback: first non-loopback IPv4, then 127.0.0.1.
	interfaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range interfaces {
			if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, addr := range addrs {
				ipnet, ok := addr.(*net.IPNet)
				if !ok || ipnet.IP.IsLoopback() || ipnet.IP.To4() == nil {
					continue
				}
				return ipnet.IP.String()
			}
		}
	}
	return "127.0.0.1"
}

func defaultRouteInterface() (string, error) {
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] == "Iface" {
			continue
		}
		if fields[1] == "00000000" {
			return fields[0], nil
		}
	}
	return "", nil
}

func interfaceIPv4(name string) string {
	iface, err := net.InterfaceByName(name)
	if err != nil {
		return ""
	}
	addrs, err := iface.Addrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		ipnet, ok := addr.(*net.IPNet)
		if !ok || ipnet.IP.To4() == nil || ipnet.IP.IsLoopback() {
			continue
		}
		return ipnet.IP.String()
	}
	return ""
}

func (s *Server) DashboardURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	host, port := s.options.Config.Bind, s.publicPort
	if s.adminLn != nil {
		host, port = "127.0.0.1", s.adminPort
	} else {
		switch host {
		case "", "0.0.0.0":
			host = "127.0.0.1"
		case "::":
			host = "::1"
		}
	}
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(port)), Path: "/dashboard"}).String()
}

func advertisedURL(host string, port int, code string) string {
	host = strings.Trim(host, "[]")
	authority := host
	if port != 80 {
		authority = net.JoinHostPort(host, strconv.Itoa(port))
	} else if strings.Contains(host, ":") {
		authority = "[" + host + "]"
	}
	join := url.URL{Scheme: "http", Host: authority, Path: "/join"}
	query := join.Query()
	query.Set("code", code)
	join.RawQuery = query.Encode()
	return join.String()
}

func (s *Server) UpdateConfig(cfg config.Config) { s.mu.Lock(); s.options.Config = cfg; s.mu.Unlock() }

func (s *Server) CloseConnections() {
	s.mu.Lock()
	connections := make([]*websocket.Conn, 0, len(s.adminWS))
	for conn := range s.adminWS {
		connections = append(connections, conn)
	}
	s.adminWS = make(map[*websocket.Conn]struct{})
	s.mu.Unlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
}

func (s *Server) Close(ctx context.Context) error {
	s.mu.Lock()
	set := listenerSet{public: s.public, admin: s.admin, publicLn: s.publicLn, adminLn: s.adminLn}
	s.public, s.admin, s.publicLn, s.adminLn = nil, nil, nil, nil
	s.mu.Unlock()
	shutdownErr := shutdownListenerSet(ctx, set)
	s.CloseConnections()
	return shutdownErr
}

func (s *Server) Rebind(ctx context.Context, cfg config.Config) error {
	// Build every replacement listener before touching the current one. A
	// failed bind therefore leaves the existing session and dashboard alive.
	s.mu.Lock()
	if s.publicLn == nil {
		s.mu.Unlock()
		return fmt.Errorf("HTTP server is not running")
	}
	s.mu.Unlock()
	replacement, err := s.buildListenerSet(cfg)
	if err != nil {
		return err
	}
	s.mu.Lock()
	old := listenerSet{public: s.public, admin: s.admin, publicLn: s.publicLn, adminLn: s.adminLn}
	connections := make([]*websocket.Conn, 0, len(s.adminWS))
	for conn := range s.adminWS {
		connections = append(connections, conn)
	}
	s.adminWS = make(map[*websocket.Conn]struct{})
	s.installListenerSet(cfg, replacement)
	s.mu.Unlock()
	for _, conn := range connections {
		_ = conn.Close()
	}
	serveListenerSet(replacement)
	return shutdownListenerSet(ctx, old)
}
