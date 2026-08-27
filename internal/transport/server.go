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
	unsubscribe     func()
}

func NewServer(s *session.Session, handler *input.Handler, layouts *layout.Library, targetInputRate int) *Server {
	server := &Server{Session: s, Input: handler, Layouts: layouts, TargetInputRate: targetInputRate, clients: make(map[*Client]struct{}), upgrader: websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024, CheckOrigin: func(r *http.Request) bool { return SameOrigin(r) }}}
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
	defer func() { client.Close(); s.mu.Lock(); delete(s.clients, client); s.mu.Unlock() }()
	s.runClient(r, client)
}

func (s *Server) runClient(r *http.Request, client *Client) {
	client.conn.SetReadLimit(4 * 1024)
	messageType, data, err := client.conn.ReadMessage()
	if err != nil || messageType != websocket.TextMessage {
		return
	}
	hello, err := protocol.DecodeHello(data)
	if err != nil || hello.ClientVersion == "" {
		// The writer goroutine is not running yet, so this synchronous write
		// cannot race it; gorilla/websocket forbids concurrent writes.
		s.sendErrorNow(client, "invalid_hello", "the first message must be a valid hello")
		return
	}
	admission, err := s.Session.Admit(hello.SessionCode, hello.DisplayName, hello.ReconnectID, hello.SelectedLayout, client.Send, client.Close)
	if err != nil {
		code, message := admissionError(err)
		s.sendErrorNow(client, code, message)
		return
	}
	player := admission.Player
	generation := player.Generation
	welcome := protocol.Welcome{Type: protocol.MessageWelcome, PlayerID: player.ID, Slot: player.Slot, DisplayName: player.Name, Accent: player.Accent, ReconnectID: player.ReconnectID, ProtocolVersion: protocol.Version, FrameSize: protocol.FrameSize, TargetInputRate: s.TargetInputRate, SelectedLayout: player.LayoutID}
	welcome.AvailableLayouts = make([]protocol.LayoutSummary, 0)
	for _, summary := range s.Layouts.Summaries() {
		welcome.AvailableLayouts = append(welcome.AvailableLayouts, protocol.LayoutSummary{ID: summary.ID, Name: summary.Name})
	}
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

func (s *Server) readClient(client *Client, playerID string, generation uint64) {
	for {
		messageType, data, err := client.conn.ReadMessage()
		if err != nil {
			_ = s.Input.Disconnect(playerID, generation)
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

func (s *Server) sendError(client *Client, code, message string) {
	_ = client.Send(protocol.ErrorMessage{Type: protocol.MessageError, Code: code, Message: message})
}

// sendErrorNow queues the error before closing the connection so the writer
// can flush it without concurrent WebSocket writes.
func (s *Server) sendErrorNow(client *Client, code, message string) {
	_ = client.sendAndClose(protocol.ErrorMessage{Type: protocol.MessageError, Code: code, Message: message})
}

func admissionError(err error) (string, string) {
	switch {
	case errors.Is(err, session.ErrInvalidCode):
		return "invalid_code", "The session code is invalid."
	case errors.Is(err, session.ErrJoinsClosed):
		return "joins_closed", "This session is not accepting new joins."
	case errors.Is(err, session.ErrSessionFull):
		return "session_full", "This session already has 16 players."
	case errors.Is(err, session.ErrInvalidReconnect):
		return "invalid_reconnect", "The reconnect window has expired. Join as a new player."
	default:
		return "device_error", "The host could not create your virtual controller."
	}
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
