package httpserver

import (
	"context"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
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
	adminLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = publicLn.Close()
		return listenerSet{}, fmt.Errorf("listen loopback admin server: %w", err)
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
	var first error
	if set.public != nil {
		if err := set.public.Shutdown(ctx); err != nil && first == nil {
			first = err
		}
	}
	if set.admin != nil {
		if err := set.admin.Shutdown(ctx); err != nil && first == nil {
			first = err
		}
	}
	if set.publicLn != nil {
		_ = set.publicLn.Close()
	}
	if set.adminLn != nil {
		_ = set.adminLn.Close()
	}
	return first
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
		listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", bind, port))
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
	return bind == "127.0.0.1" || bind == "::1" || strings.EqualFold(bind, "localhost")
}

func (s *Server) AdvertisedJoinURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	host := s.options.Config.AdvertisedHost
	if host == "" {
		host = "127.0.0.1"
	}
	port := s.options.Config.AdvertisedPort
	if port == 0 {
		port = s.publicPort
	}
	return advertisedURL(host, port, s.options.Session.Code())
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
