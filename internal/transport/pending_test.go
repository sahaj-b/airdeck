package transport

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
)

func readError(t *testing.T, conn *websocket.Conn) protocol.ErrorMessage {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read error message: %v", err)
	}
	var message protocol.ErrorMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatalf("decode error: %v (body %s)", err, data)
	}
	if message.Type != protocol.MessageError {
		t.Fatalf("got %s, want error", data)
	}
	return message
}

func TestApprovalPendingAcceptServesWelcome(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	sess.SetApprovalRequired(true)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	pending := readError(t, conn)
	if pending.Code != "pending" {
		t.Fatalf("pending code = %q, want pending", pending.Code)
	}
	pendings := sess.Pendings()
	if len(pendings) != 1 {
		t.Fatalf("pendings = %d, want 1", len(pendings))
	}
	admission, err := sess.AcceptPending(pendings[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	welcome := readWelcome(t, conn)
	_ = readLayout(t, conn)
	if welcome.PlayerID != admission.Player.ID || welcome.Slot != admission.Player.Slot {
		t.Fatalf("welcome = %+v, want player %v", welcome, admission.Player)
	}
	if welcome.DisplayName != "Player 1" {
		t.Fatalf("welcome display = %q, want fallback renumber Player 1", welcome.DisplayName)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitSouth}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	if len(devices) != 1 {
		t.Fatalf("device count = %d, want 1", len(devices))
	}
}

func TestApprovalPendingRejectDeclinesAndCloses(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	sess.SetApprovalRequired(true)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	pending := readError(t, conn)
	if pending.Code != "pending" {
		t.Fatalf("pending code = %q, want pending", pending.Code)
	}
	pendings := sess.Pendings()
	if len(pendings) != 1 {
		t.Fatalf("pendings = %d, want 1", len(pendings))
	}
	if err := sess.RejectPending(pendings[0].ID, "party is full"); err != nil {
		t.Fatal(err)
	}
	declined := readError(t, conn)
	if declined.Code != "declined" || declined.Message != "party is full" {
		t.Fatalf("declined = %+v, want code declined with reason", declined)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("socket stayed open after declined close")
	}
}

func TestApprovalPendingDisconnectEvaporates(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	sess.SetApprovalRequired(true)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	pending := readError(t, conn)
	if pending.Code != "pending" {
		t.Fatalf("pending code = %q, want pending", pending.Code)
	}
	_ = conn.Close()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(sess.Pendings()) == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("pending did not evaporate after disconnect")
}

func TestApprovalReclaimSkipsQueueOnWire(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	first := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	welcome := readWelcome(t, first)
	_ = readLayout(t, first)
	first.Close()
	// Wait for grace.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if player, ok := sess.Player(welcome.PlayerID); ok && player.State == session.StateDisconnectedGrace {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	sess.SetApprovalRequired(true)
	second := dialTransportClientWithReconnect(t, wsURL, httpServer.URL, sess.Code(), welcome.ReconnectID)
	defer second.Close()
	reconnected := readWelcome(t, second)
	_ = readLayout(t, second)
	if reconnected.PlayerID != welcome.PlayerID {
		t.Fatalf("reclaim player = %q, want %q", reconnected.PlayerID, welcome.PlayerID)
	}
	if len(sess.Pendings()) != 0 {
		t.Fatal("reclaim queued a pending, want direct admit")
	}
}

func TestApprovalAcceptRacingDisconnectCleansUp(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	sess.SetApprovalRequired(true)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	if pending := readError(t, conn); pending.Code != "pending" {
		t.Fatalf("pending code = %q, want pending", pending.Code)
	}
	pendings := sess.Pendings()
	if len(pendings) != 1 {
		t.Fatalf("pendings = %d, want 1", len(pendings))
	}
	// Disconnect races the dashboard accept. Either order must leave no
	// leaked Active player: evaporate wins (no player at all) or accept
	// wins (player already scheduled for grace Disconnect).
	_ = conn.Close()
	admission, acceptErr := sess.AcceptPending(pendings[0].ID)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(sess.Pendings()) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pendings := sess.Pendings(); len(pendings) != 0 {
		t.Fatalf("pendings = %d after race, want 0", len(pendings))
	}
	players := sess.Players()
	if acceptErr != nil {
		if !errors.Is(acceptErr, session.ErrPendingNotFound) {
			t.Fatalf("race accept error = %v, want pending_gone", acceptErr)
		}
		if len(players) != 0 {
			t.Fatalf("evaporated race left %d players, want 0", len(players))
		}
		return
	}
	if len(players) != 1 || players[0].ID != admission.Player.ID {
		t.Fatalf("race players = %+v, want the accepted one", players)
	}
	// The Disconnect is deferred to servePending return, microseconds
	// behind AcceptPending: poll for grace instead of asserting at once.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		player, ok := sess.Player(admission.Player.ID)
		if ok && player.State == session.StateDisconnectedGrace {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	player, _ := sess.Player(admission.Player.ID)
	t.Fatalf("race player state = %v, want disconnected-grace (leaked Active)", player.State)
}
