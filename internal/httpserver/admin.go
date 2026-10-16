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
	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
)

type adminState struct {
	Code                 string                    `json:"code"`
	AcceptingJoins       bool                      `json:"acceptingJoins"`
	AdvertisedJoinURL    string                    `json:"advertisedJoinURL"`
	OnlineJoinURL        string                    `json:"onlineJoinURL"`
	CentralReachable     bool                      `json:"centralReachable"`
	ClaimConflict        string                    `json:"claimConflict,omitempty"`
	AdvertisedCandidates []string                  `json:"advertisedCandidates"`
	PublicPort           int                       `json:"publicPort"`
	AdminPort            int                       `json:"adminPort"`
	Config               config.Config             `json:"config"`
	Layouts              []layout.Summary          `json:"layouts"`
	Players              []session.PlayerSnapshot  `json:"players"`
	Pendings             []session.PendingSnapshot `json:"pendings"`
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
		mux.HandleFunc("/api/layouts/publish", s.handlePublishCreate)
		mux.HandleFunc("/api/layouts/publish/", s.handlePublishCancel)
		mux.HandleFunc("/api/layouts", s.handlePublicLayoutsList)
		mux.HandleFunc("/api/layouts/", s.handlePublicLayoutGet)
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
	mux.HandleFunc("/editor", func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackRequest(r) {
			http.Error(w, "editor is local to the host", http.StatusForbidden)
			return
		}
		s.staticHandler(w, r)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if adminOnly && !strings.HasPrefix(r.URL.Path, "/api/admin/") && r.URL.Path != "/dashboard" && r.URL.Path != "/editor" {
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
	agent := s.options.Online
	s.mu.Unlock()
	players := s.options.Session.Players()
	sort.Slice(players, func(i, j int) bool { return players[i].Slot < players[j].Slot })
	if agent != nil {
		for i := range players {
			players[i].Relayed = agent.IsRelayed(players[i].ID)
			players[i].RelayState = string(agent.RelayTransport(players[i].ID))
		}
	} else {
		// No agent (LAN-only tests): mark explicitly so the badge shows
		// pending instead of silently omitting the field.
		for i := range players {
			players[i].RelayState = "unknown"
		}
	}
	var pendings []session.PendingSnapshot
	if agent == nil {
		pendings = s.options.Session.Pendings()
	} else {
		pendings = s.pendingJoins(agent)
	}
	state := adminState{
		Code:                 s.options.Session.Code(),
		AcceptingJoins:       s.options.Session.AcceptingJoins(),
		AdvertisedJoinURL:    s.AdvertisedJoinURL(),
		OnlineJoinURL:        s.OnlineJoinURL(),
		AdvertisedCandidates: advertisedCandidates(),
		PublicPort:           publicPort,
		AdminPort:            adminPort,
		Config:               cfg,
		Layouts:              s.options.Layouts.Summaries(),
		Players:              players,
		Pendings:             pendings,
	}
	if agent != nil {
		state.CentralReachable = agent.Reachable()
		state.ClaimConflict = agent.Conflict()
	}
	return state
}

// pendingJoins merges relay pendings plus LAN session pendings.
func (s *Server) pendingJoins(agent interface {
	Pendings() []session.PendingSnapshot
	OwnsSessionPending(string) bool
},
) []session.PendingSnapshot {
	out := agent.Pendings()
	if out == nil {
		out = []session.PendingSnapshot{}
	}
	for _, snapshot := range s.options.Session.Pendings() {
		if agent.OwnsSessionPending(snapshot.ID) {
			continue
		}
		out = append(out, snapshot)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].WaitingSince.Before(out[j].WaitingSince) })
	return out
}

func advertisedCandidates() []string {
	primary := defaultAdvertisedHost()
	ips := allLocalIPv4s()
	seen := make(map[string]struct{}, len(ips)+1)
	var out []string
	if primary != "" && primary != "127.0.0.1" {
		seen[primary] = struct{}{}
		out = append(out, primary)
	}
	var rest []string
	for _, ip := range ips {
		if _, ok := seen[ip]; !ok {
			seen[ip] = struct{}{}
			rest = append(rest, ip)
		}
	}
	sort.Strings(rest)
	out = append(out, rest...)
	return out
}

func (s *Server) adminAPI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/admin")
	switch {
	case path == "/state" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.currentState())
	case path == "/session/new" && r.Method == http.MethodPost:
		if err := s.options.Session.NewSession(); err != nil {
			writeError(w, err)
			return
		}
		if agent := s.options.Online; agent != nil {
			agent.ClearApprovals()
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
	case strings.HasPrefix(path, "/approval/"):
		s.approvalAPI(w, r, strings.TrimPrefix(path, "/approval/"))
	case path == "/room-code" && r.Method == http.MethodPut:
		s.setRoomCodeAPI(w, r)
	case path == "/room-code/generate" && r.Method == http.MethodPost:
		s.generateRoomCodeAPI(w, r)
	case path == "/players/layout" && r.Method == http.MethodPut:
		s.bulkLayoutAPI(w, r)
	case strings.HasPrefix(path, "/players/"):
		s.playerAPI(w, r, strings.TrimPrefix(path, "/players/"))
	case strings.HasPrefix(path, "/layouts/publish/"):
		if strings.HasSuffix(path, "/accept") {
			s.handlePublishAccept(w, r)
			return
		}
		if strings.HasSuffix(path, "/decline") {
			s.handlePublishDecline(w, r)
			return
		}
		http.NotFound(w, r)
	case strings.HasPrefix(path, "/layouts"):
		s.layoutAdminAPI(w, r, strings.TrimPrefix(path, "/layouts"))
	case path == "/ws" && r.Method == http.MethodGet:
		s.adminWebSocket(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) handlePublicLayoutsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	summaries := s.options.Layouts.Summaries()
	out := make([]map[string]string, 0, len(summaries))
	for _, summary := range summaries {
		out = append(out, map[string]string{"id": summary.ID, "name": summary.Name})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePublicLayoutGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/layouts/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	doc, ok := s.options.Layouts.Get(id)
	if !ok {
		writeErrorStatus(w, errors.New("layout not found"), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) layoutAdminAPI(w http.ResponseWriter, r *http.Request, path string) {
	if path == "/reload" && r.Method == http.MethodPost {
		if err := s.options.Layouts.Reload(); err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		s.options.Session.ReconcileLayouts()
		s.options.Session.PushAllLayouts()
		s.broadcastPhoneLayouts()
		s.BroadcastAdminState()
		writeJSON(w, http.StatusOK, s.currentState())
		return
	}
	if path == "" || path == "/" {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxPublishBytes)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		doc, err := layout.ValidateJSON(data)
		if err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		if err := s.options.Layouts.Create(doc); err != nil {
			if errors.Is(err, layout.ErrBuiltinProtected) {
				writeErrorStatus(w, err, http.StatusForbidden)
				return
			}
			if errors.Is(err, layout.ErrLayoutExists) {
				writeErrorStatus(w, err, http.StatusConflict)
				return
			}
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		s.broadcastPhoneLayouts()
		s.BroadcastAdminState()
		writeJSON(w, http.StatusCreated, doc)
		return
	}
	id := strings.TrimPrefix(path, "/")
	if strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodGet:
		doc, ok := s.options.Layouts.Get(id)
		if !ok {
			writeErrorStatus(w, errors.New("layout not found"), http.StatusNotFound)
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, maxPublishBytes)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		doc, err := layout.ValidateJSON(data)
		if err != nil {
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		if doc.ID != id {
			writeErrorStatus(w, errors.New("document id must match url"), http.StatusBadRequest)
			return
		}
		if err := s.options.Layouts.Update(doc); err != nil {
			if errors.Is(err, layout.ErrBuiltinProtected) {
				writeErrorStatus(w, err, http.StatusForbidden)
				return
			}
			if errors.Is(err, layout.ErrLayoutNotFound) {
				writeErrorStatus(w, err, http.StatusNotFound)
				return
			}
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		s.options.Session.PushLayoutUpdate(doc.ID)
		s.broadcastPhoneLayouts()
		s.BroadcastAdminState()
		writeJSON(w, http.StatusOK, doc)
	case http.MethodDelete:
		if err := s.options.Layouts.Delete(id); err != nil {
			if errors.Is(err, layout.ErrBuiltinProtected) {
				writeErrorStatus(w, err, http.StatusForbidden)
				return
			}
			if errors.Is(err, layout.ErrLayoutNotFound) {
				writeErrorStatus(w, err, http.StatusNotFound)
				return
			}
			if errors.Is(err, layout.ErrDefaultProtected) {
				writeErrorStatus(w, err, http.StatusBadRequest)
				return
			}
			writeErrorStatus(w, err, http.StatusBadRequest)
			return
		}
		s.options.Session.ReconcileLayouts()
		s.broadcastPhoneLayouts()
		s.BroadcastAdminState()
		writeJSON(w, http.StatusOK, s.currentState())
	default:
		methodNotAllowed(w)
	}
}

func (s *Server) bulkLayoutAPI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		LayoutID string `json:"layoutId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	if _, ok := s.options.Layouts.Get(body.LayoutID); !ok {
		writeErrorStatus(w, fmt.Errorf("layout %q is not available", body.LayoutID), http.StatusBadRequest)
		return
	}
	for _, player := range s.options.Session.Players() {
		_ = s.options.Session.SetLayout(player.ID, body.LayoutID)
	}
	writeJSON(w, http.StatusOK, s.currentState())
}

func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	current := s.options.Config
	s.mu.Unlock()
	var update struct {
		Bind               *string `json:"bind"`
		Port               *int    `json:"port"`
		AdvertisedHost     *string `json:"advertisedHost"`
		AdvertisedPort     *int    `json:"advertisedPort"`
		DefaultLayout      *string `json:"defaultLayout"`
		GracePeriodSeconds *int    `json:"gracePeriodSeconds"`
		ApprovalRequired   *bool   `json:"approvalRequired"`
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
	if update.GracePeriodSeconds != nil {
		current.GracePeriodSeconds = *update.GracePeriodSeconds
	}
	if update.ApprovalRequired != nil {
		current.ApprovalRequired = *update.ApprovalRequired
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
	}
	if update.GracePeriodSeconds != nil && current.GracePeriodSeconds != previous.GracePeriodSeconds {
		s.options.Session.SetGracePeriod(time.Duration(current.GracePeriodSeconds) * time.Second)
	}
	if current.ApprovalRequired != previous.ApprovalRequired {
		s.options.Session.SetApprovalRequired(current.ApprovalRequired)
		s.mu.Lock()
		agent := s.options.Online
		s.mu.Unlock()
		if agent != nil {
			agent.SetApprovalRequired(current.ApprovalRequired)
		}
	}
	if current != previous {
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

// approvalAPI drives the dashboard approval queue.
func (s *Server) approvalAPI(w http.ResponseWriter, r *http.Request, value string) {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	id, action := parts[0], parts[1]
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	s.mu.Lock()
	agent := s.options.Online
	s.mu.Unlock()
	switch action {
	case "accept":
		if agent != nil {
			err := agent.AcceptPending(id)
			if err == nil {
				writeJSON(w, http.StatusOK, s.currentState())
				return
			}
			if !errors.Is(err, session.ErrPendingNotFound) {
				writeApprovalError(w, err)
				return
			}
		}
		if _, err := s.options.Session.AcceptPending(id); err != nil {
			writeApprovalError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, s.currentState())
	case "reject":
		var body struct {
			Reason string `json:"reason"`
		}
		// Reason is optional; an empty body still rejects. ContentLength
		// is -1 for chunked uploads, so check the body itself: EOF means
		// empty reason, not a 400.
		if r.Body != nil {
			if err := decodeJSON(r, &body); err != nil {
				if errors.Is(err, io.EOF) {
					body.Reason = ""
				} else {
					writeErrorStatus(w, err, http.StatusBadRequest)
					return
				}
			}
		}
		if agent != nil {
			err := agent.RejectPending(id, body.Reason)
			if err == nil {
				writeJSON(w, http.StatusOK, s.currentState())
				return
			}
			if !errors.Is(err, session.ErrPendingNotFound) {
				writeApprovalError(w, err)
				return
			}
		}
		if err := s.options.Session.RejectPending(id, body.Reason); err != nil {
			writeApprovalError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, s.currentState())
	default:
		http.NotFound(w, r)
	}
}

func writeApprovalError(w http.ResponseWriter, err error) {
	if errors.Is(err, session.ErrSessionFull) {
		writeErrorStatus(w, err, http.StatusConflict)
		return
	}
	if errors.Is(err, session.ErrPendingNotFound) {
		writeErrorStatus(w, err, http.StatusNotFound)
		return
	}
	writeError(w, err)
}

// applyRoomCode validates, persists, and fans out one room code to the
// session, the online agent, and the settings hook.
func (s *Server) applyRoomCode(w http.ResponseWriter, code string, validateStatus int) {
	s.mu.Lock()
	current := s.options.Config
	agent := s.options.Online
	s.mu.Unlock()
	current.RoomCode = code
	if err := config.Validate(current); err != nil {
		writeErrorStatus(w, err, validateStatus)
		return
	}
	s.UpdateConfig(current)
	if agent != nil {
		// Agent owns session fan-out (code + approval + reconnect).
		agent.SetCode(current.RoomCode, current.ApprovalRequired)
	} else {
		s.options.Session.SetCode(current.RoomCode)
	}
	if s.options.OnSettings != nil {
		if err := s.options.OnSettings(current); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, s.currentState())
}

// setRoomCodeAPI installs a custom room code from the dashboard.
func (s *Server) setRoomCodeAPI(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RoomCode string `json:"roomCode"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	if err := roomcode.Validate(body.RoomCode); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	s.applyRoomCode(w, roomcode.Normalize(body.RoomCode), http.StatusBadRequest)
}

// generateRoomCodeAPI mints a fresh 6-char code.
func (s *Server) generateRoomCodeAPI(w http.ResponseWriter, r *http.Request) {
	code, err := roomcode.Generate()
	if err != nil {
		writeError(w, err)
		return
	}
	s.applyRoomCode(w, code, http.StatusInternalServerError)
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
	s.lifecycleMu.Lock()
	if s.closed {
		s.lifecycleMu.Unlock()
		http.Error(w, "HTTP server is closed", http.StatusServiceUnavailable)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.lifecycleMu.Unlock()
		return
	}
	out := make(chan any, 32)
	s.mu.Lock()
	s.adminWS[conn] = out
	s.mu.Unlock()
	s.lifecycleMu.Unlock()
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
	// 1 Hz state push keeps lastInput ages and RTT fresh between events.
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
		case value := <-out:
			if err := conn.WriteJSON(value); err != nil {
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
