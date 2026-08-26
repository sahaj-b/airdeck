package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
)

type adminState struct {
	Code              string                   `json:"code"`
	AcceptingJoins    bool                     `json:"acceptingJoins"`
	AdvertisedJoinURL string                   `json:"advertisedJoinURL"`
	PublicPort        int                      `json:"publicPort"`
	AdminPort         int                      `json:"adminPort"`
	Config            config.Config            `json:"config"`
	Layouts           []layout.Summary         `json:"layouts"`
	Players           []session.PlayerSnapshot `json:"players"`
}

type adminEvent struct {
	Type    string                  `json:"type"`
	Player  *session.PlayerSnapshot `json:"player,omitempty"`
	Message string                  `json:"message,omitempty"`
	State   adminState              `json:"state"`
}

func (s *Server) routes(adminOnly bool) http.Handler {
	mux := http.NewServeMux()
	if !adminOnly {
		mux.HandleFunc("/ws", s.options.Transport.ServeHTTP)
	}
	mux.HandleFunc("/api/admin/", func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackRequest(r) {
			http.Error(w, "admin access is local to the host", http.StatusForbidden)
			return
		}
		s.adminAPI(w, r)
	})
	mux.HandleFunc("/dashboard", func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackRequest(r) {
			http.Error(w, "dashboard access is local to the host", http.StatusForbidden)
			return
		}
		s.staticHandler(w, r)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if adminOnly && !strings.HasPrefix(r.URL.Path, "/api/admin/") && r.URL.Path != "/dashboard" && !strings.HasPrefix(r.URL.Path, "/assets/") {
			http.NotFound(w, r)
			return
		}
		s.staticHandler(w, r)
	})
	return mux
}

func isLoopbackRequest(r *http.Request) bool { return transport.IsLoopbackRemote(r.RemoteAddr) }

func (s *Server) currentState() adminState {
	s.mu.Lock()
	cfg, publicPort, adminPort := s.options.Config, s.publicPort, s.adminPort
	s.mu.Unlock()
	players := s.options.Session.Players()
	sort.Slice(players, func(i, j int) bool { return players[i].Slot < players[j].Slot })
	return adminState{
		Code:              s.options.Session.Code(),
		AcceptingJoins:    s.options.Session.AcceptingJoins(),
		AdvertisedJoinURL: s.AdvertisedJoinURL(),
		PublicPort:        publicPort,
		AdminPort:         adminPort,
		Config:            cfg,
		Layouts:           s.options.Layouts.Summaries(),
		Players:           players,
	}
}

func (s *Server) adminAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin")
	switch {
	case path == "/state" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.currentState())
	case path == "/diagnostics" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"summary": s.options.Input.Metrics(),
			"trace":   s.options.Input.TraceSnapshot(),
		})
	case path == "/session/new" && r.Method == http.MethodPost:
		if err := s.options.Session.NewSession(); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, s.currentState())
	case path == "/joins" && r.Method == http.MethodPut:
		var body struct {
			AcceptingJoins bool `json:"acceptingJoins"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		s.options.Session.SetAcceptingJoins(body.AcceptingJoins)
		writeJSON(w, http.StatusOK, s.currentState())
	case path == "/settings" && r.Method == http.MethodPut:
		s.updateSettings(w, r)
	case strings.HasPrefix(path, "/players/"):
		s.playerAPI(w, r, strings.TrimPrefix(path, "/players/"))
	case path == "/ws" && r.Method == http.MethodGet:
		s.adminWebSocket(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	current := s.options.Config
	s.mu.Unlock()
	var update struct {
		Bind           *string `json:"bind"`
		Port           *int    `json:"port"`
		AdvertisedHost *string `json:"advertisedHost"`
		AdvertisedPort *int    `json:"advertisedPort"`
		DefaultLayout  *string `json:"defaultLayout"`
	}
	if err := decodeJSON(r, &update); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	previous := current
	if update.Bind != nil {
		current.Bind = *update.Bind
	}
	if update.Port != nil {
		current.Port = *update.Port
	}
	if update.AdvertisedHost != nil {
		current.AdvertisedHost = *update.AdvertisedHost
	}
	if update.AdvertisedPort != nil {
		current.AdvertisedPort = *update.AdvertisedPort
	}
	if update.DefaultLayout != nil {
		current.DefaultLayout = *update.DefaultLayout
	}
	if err := config.Validate(current); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	if _, ok := s.options.Layouts.Get(current.DefaultLayout); !ok {
		writeErrorStatus(w, fmt.Errorf("layout %q is not available", current.DefaultLayout), http.StatusBadRequest)
		return
	}
	if current.Bind != previous.Bind || current.Port != previous.Port {
		if err := s.Rebind(r.Context(), current); err != nil {
			writeErrorStatus(w, err, http.StatusConflict)
			return
		}
	} else {
		s.UpdateConfig(current)
	}
	if current.DefaultLayout != previous.DefaultLayout {
		if err := s.options.Session.SetDefaultLayout(current.DefaultLayout); err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
	} else if current != previous {
		s.options.Session.NotifySettings()
	}
	if s.options.OnSettings != nil {
		if err := s.options.OnSettings(current); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, s.currentState())
}

func (s *Server) playerAPI(w http.ResponseWriter, r *http.Request, value string) {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	id, action := parts[0], parts[1]
	switch action {
	case "kick":
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		if err := s.options.Session.Kick(id); err != nil {
			writeError(w, err)
			return
		}
	case "move":
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		var body struct {
			Slot int `json:"slot"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		if err := s.options.Session.Move(id, body.Slot); err != nil {
			writeError(w, err)
			return
		}
	case "layout":
		if r.Method != http.MethodPut {
			methodNotAllowed(w)
			return
		}
		var body struct {
			LayoutID string `json:"layoutId"`
		}
		if err := decodeJSON(r, &body); err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		if err := s.options.Session.SetLayout(id, body.LayoutID); err != nil {
			writeError(w, err)
			return
		}
	default:
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, s.currentState())
}

func (s *Server) adminWebSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.mu.Lock()
	s.adminWS[conn] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.adminWS, conn)
		s.mu.Unlock()
		_ = conn.Close()
	}()
	events := make(chan session.Event, 32)
	unsubscribe := s.options.Session.Subscribe(func(event session.Event) {
		select {
		case events <- event:
		default:
		}
	})
	defer unsubscribe()
	if err := conn.WriteJSON(s.currentState()); err != nil {
		return
	}
	readDone := make(chan struct{})
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				close(readDone)
				return
			}
		}
	}()
	// Push the full state at 1 Hz so inputs, lastInput ages, and RTT refresh
	// between session events. ApplyInput never emits an event, so without this
	// the dashboard would freeze lastInput at the last join/kick/stale update.
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-readDone:
			return
		case <-ticker.C:
			if err := conn.WriteJSON(adminEvent{Type: "state", State: s.currentState()}); err != nil {
				return
			}
		case event := <-events:
			message := adminEvent{Type: event.Type, Player: event.Player, Message: event.Message, State: s.currentState()}
			if err := conn.WriteJSON(message); err != nil {
				return
			}
		}
	}
}

func decodeJSON(r *http.Request, value any) error {
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request contains trailing data")
	}
	return nil
}

func methodNotAllowed(w http.ResponseWriter) {
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) { writeErrorStatus(w, err, http.StatusBadRequest) }

func writeErrorStatus(w http.ResponseWriter, err error, status int) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
