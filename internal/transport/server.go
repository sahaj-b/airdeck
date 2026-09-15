package transport

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
)

type Server struct {
	Session         *session.Session
	Input           *input.Handler
	Layouts         *layout.Library
	TargetInputRate int
	upgrader        websocket.Upgrader
	mu              sync.Mutex
	clients         map[*Client]struct{}
	clientsByID     map[string]*Client
	unsubscribe     func()
}

func NewServer(s *session.Session, handler *input.Handler, layouts *layout.Library, targetInputRate int) *Server {
	server := &Server{Session: s, Input: handler, Layouts: layouts, TargetInputRate: targetInputRate, clients: make(map[*Client]struct{}), clientsByID: make(map[string]*Client), upgrader: websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024, CheckOrigin: func(r *http.Request) bool { return SameOrigin(r) }}}
	server.unsubscribe = s.Subscribe(func(event session.Event) {
		if event.Type == "session.reset" {
			server.broadcastReset()
		}
	})
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !SameOrigin(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := newClient(conn)
	client.startWriter()
	s.mu.Lock()
	s.clients[client] = struct{}{}
	s.mu.Unlock()
	var playerIDForCleanup string
	defer func() {
		client.Close()
		s.mu.Lock()
		delete(s.clients, client)
		if playerIDForCleanup != "" {
			if current, ok := s.clientsByID[playerIDForCleanup]; ok && current == client {
				delete(s.clientsByID, playerIDForCleanup)
			}
		}
		s.mu.Unlock()
	}()
	// runClient will populate playerIDForCleanup when admission succeeds.
	s.runClient(client, &playerIDForCleanup)
}

func (s *Server) runClient(client *Client, playerIDForCleanup *string) {
	client.conn.SetReadLimit(4 * 1024)
	messageType, data, err := client.conn.ReadMessage()
	if err != nil || messageType != websocket.TextMessage {
		return
	}
	hello, err := protocol.DecodeHello(data)
	if err != nil || hello.ClientVersion == "" {
		// Queue the final error through the single writer before closing.
		s.sendError(client, "invalid_hello", "the first message must be a valid hello", true)
		return
	}
	admission, err := s.Session.Admit(hello.SessionCode, hello.DisplayName, hello.ReconnectID, hello.SelectedLayout, client.Send, client.Close)
	if err != nil {
		if errors.Is(err, session.ErrApprovalPending) {
			s.servePending(client, admission, playerIDForCleanup)
			return
		}
		code, message := session.AdmissionError(err)
		s.sendError(client, code, message, true)
		return
	}
	player := admission.Player
	generation := player.Generation
	defer func() {
		_ = s.Input.Disconnect(player.ID, generation)
	}()
	s.mu.Lock()
	s.clientsByID[player.ID] = client
	if playerIDForCleanup != nil {
		*playerIDForCleanup = player.ID
	}
	s.mu.Unlock()
	welcome := session.BuildWelcome(player, s.Layouts, s.TargetInputRate)
	if err := client.Send(welcome); err != nil {
		return
	}
	document, err := s.Session.Layout(player.ID)
	if err != nil {
		return
	}
	if err := client.Send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: document.ID, Layout: document}); err != nil {
		return
	}
	s.heartbeat(client, player.ID)
	s.readClient(client, player.ID, generation)
}

// servePending parks an approval-gated LAN join with its socket open until
// accept, reject, or disconnect. One reader goroutine owns every socket
// read; the wait never uses read deadlines because gorilla reads are sticky.
func (s *Server) servePending(client *Client, admission session.Admission, playerIDForCleanup *string) {
	pendingID := admission.PendingID
	wait := admission.PendingWait
	if pendingID == "" || wait == nil {
		s.sendError(client, "device_error", "The host could not queue your join.", true)
		return
	}
	code, message := session.AdmissionError(session.ErrApprovalPending)
	s.sendError(client, code, message)
	accepted := false
	disconnected := false
	defer func() {
		if !accepted {
			s.Session.RemovePending(pendingID)
		}
	}()

	var stateMu sync.Mutex
	serving := false
	var playerID string
	var generation uint64
	done := make(chan struct{}, 1)
	signalDone := func() {
		select {
		case done <- struct{}{}:
		default:
		}
	}
	// The reader ignores input before accept (no player yet) and mirrors
	// readClient dispatch after main flips serving on accept.
	go func() {
		for {
			messageType, data, err := client.conn.ReadMessage()
			if err != nil {
				signalDone()
				return
			}
			stateMu.Lock()
			on := serving
			pid := playerID
			gen := generation
			stateMu.Unlock()
			if !on {
				if messageType == websocket.TextMessage {
					if typeName, _ := protocol.MessageType(data); typeName == protocol.MessageClose {
						signalDone()
						return
					}
				}
				continue
			}
			switch messageType {
			case websocket.BinaryMessage:
				frame, err := protocol.DecodeFrame(data)
				if err != nil {
					s.sendError(client, "invalid_frame", err.Error())
					continue
				}
				if err := s.Input.Handle(pid, gen, frame); err != nil && !errors.Is(err, session.ErrGeneration) {
					s.sendError(client, "input_rejected", err.Error())
				}
			case websocket.TextMessage:
				s.handleText(client, pid, gen, data)
			default:
				s.sendError(client, "invalid_message", "unsupported WebSocket message type")
			}
		}
	}()

	handleOutcome := func(outcome session.PendingOutcome) {
		if outcome.Err != nil {
			if errors.Is(outcome.Err, session.ErrDeclined) {
				declinedCode, declinedMsg := session.AdmissionError(outcome.Err)
				if outcome.Reason != "" {
					declinedMsg = outcome.Reason
				}
				s.sendError(client, declinedCode, declinedMsg, true)
			} else {
				goneCode, goneMsg := session.AdmissionError(outcome.Err)
				s.sendError(client, goneCode, goneMsg, true)
			}
			return
		}
		player := outcome.Admission.Player
		gen := player.Generation
		accepted = true
		stateMu.Lock()
		serving = true
		playerID = player.ID
		generation = gen
		stateMu.Unlock()
		defer func() {
			_ = s.Input.Disconnect(player.ID, gen)
		}()
		s.mu.Lock()
		s.clientsByID[player.ID] = client
		if playerIDForCleanup != nil {
			*playerIDForCleanup = player.ID
		}
		s.mu.Unlock()
		welcome := session.BuildWelcome(player, s.Layouts, s.TargetInputRate)
		if err := client.Send(welcome); err != nil {
			return
		}
		document, err := s.Session.Layout(player.ID)
		if err != nil {
			return
		}
		if err := client.Send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: document.ID, Layout: document}); err != nil {
			return
		}
		s.heartbeat(client, player.ID)
		if !disconnected {
			<-done
		}
	}

	select {
	case outcome := <-wait:
		handleOutcome(outcome)
		return
	case <-done:
		disconnected = true
		// Evaporate under the session lock first so a later Accept fails
		// clean with pending_gone, then drain an already-queued decision.
		// Accept wins when it deleted first: RemovePending no-ops, the
		// drain serves the accept, and grace reclaims the dead socket's
		// slot instead of leaking an Active player with no Disconnect
		// ever scheduled.
		s.Session.RemovePending(pendingID)
		select {
		case outcome := <-wait:
			handleOutcome(outcome)
		default:
		}
		return
	}
}

func (s *Server) readClient(client *Client, playerID string, generation uint64) {
	for {
		messageType, data, err := client.conn.ReadMessage()
		if err != nil {
			return
		}
		switch messageType {
		case websocket.BinaryMessage:
			frame, err := protocol.DecodeFrame(data)
			if err != nil {
				s.sendError(client, "invalid_frame", err.Error())
				continue
			}
			if err := s.Input.Handle(playerID, generation, frame); err != nil && !errors.Is(err, session.ErrGeneration) {
				s.sendError(client, "input_rejected", err.Error())
			}
		case websocket.TextMessage:
			s.handleText(client, playerID, generation, data)
		default:
			s.sendError(client, "invalid_message", "unsupported WebSocket message type")
		}
	}
}

func (s *Server) handleText(client *Client, playerID string, generation uint64, data []byte) {
	typeName, err := protocol.MessageType(data)
	if err != nil {
		s.sendError(client, "invalid_message", err.Error())
		return
	}
	switch typeName {
	case protocol.MessagePong:
		var pong protocol.Pong
		if json.Unmarshal(data, &pong) != nil {
			return
		}
		if sent, ok := client.takePing(pong.ID); ok {
			_ = s.Session.SetPong(playerID, generation, time.Since(sent))
		}
	case protocol.MessageLayoutSelect:
		var selectMessage protocol.LayoutSelect
		if err := json.Unmarshal(data, &selectMessage); err != nil {
			s.sendError(client, "invalid_layout", err.Error())
			return
		}
		if err := s.Session.SetLayout(playerID, selectMessage.ID); err != nil {
			s.sendError(client, "invalid_layout", err.Error())
		}
	case protocol.MessageClose:
		_ = s.Session.Leave(playerID, generation)
		client.Close()
	default:
		s.sendError(client, "invalid_message", fmt.Sprintf("unsupported message type %q", typeName))
	}
}

func (s *Server) heartbeat(client *Client, playerID string) {
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-client.done:
				return
			case now := <-ticker.C:
				id := fmt.Sprintf("%d", now.UnixNano())
				client.trackPing(id, now)
				ping := protocol.Ping{Type: protocol.MessagePing, ID: id, Sent: uint64(now.UnixNano())}
				if snapshot, ok := s.Session.Player(playerID); ok && snapshot.RTT > 0 {
					ping.RttMs = snapshot.RTT / int64(time.Millisecond)
				}
				if err := client.Send(ping); err != nil {
					return
				}
			}
		}
	}()
}

func (s *Server) sendError(client *Client, code, message string, closeAfter ...bool) {
	errMsg := protocol.ErrorMessage{Type: protocol.MessageError, Code: code, Message: message}
	if len(closeAfter) > 0 && closeAfter[0] {
		_ = client.sendAndClose(errMsg)
		return
	}
	_ = client.Send(errMsg)
}

func (s *Server) broadcastReset() {
	s.mu.Lock()
	clients := make([]*Client, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	s.mu.Unlock()
	for _, client := range clients {
		_ = client.sendAndClose(protocol.ResetMessage{Type: protocol.MessageReset})
	}
}

func (s *Server) SendToPlayer(playerID string, value any) error {
	s.mu.Lock()
	client, ok := s.clientsByID[playerID]
	s.mu.Unlock()
	if !ok {
		return errors.New("player not connected")
	}
	return client.Send(value)
}

// BroadcastLayouts pushes the current layout catalogue to every connected
// phone. Call it after any library mutation (publish accept, dashboard
// create/update/delete/reload) so phone pickers stay in sync without rejoin.
func (s *Server) BroadcastLayouts() {
	summaries := s.Layouts.Summaries()
	layouts := make([]protocol.LayoutSummary, 0, len(summaries))
	for _, summary := range summaries {
		layouts = append(layouts, protocol.LayoutSummary{ID: summary.ID, Name: summary.Name})
	}
	message := protocol.LayoutsMessage{Type: protocol.MessageLayouts, Layouts: layouts}
	s.mu.Lock()
	clients := make([]*Client, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	s.mu.Unlock()
	for _, client := range clients {
		_ = client.Send(message)
	}
}

func (s *Server) Close() {
	if s.unsubscribe != nil {
		s.unsubscribe()
		s.unsubscribe = nil
	}
	s.mu.Lock()
	clients := make([]*Client, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	s.mu.Unlock()
	for _, client := range clients {
		client.finishClose()
	}
}
