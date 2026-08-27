package transport

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/device"

	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type transportFakeDevice struct {
	mu          sync.Mutex
	states      []uinput.State
	neutralized int
	destroyed   int
}

func (d *transportFakeDevice) Apply(state uinput.State) error {
	d.mu.Lock()
	d.states = append(d.states, state)
	d.mu.Unlock()
	return nil
}

func (d *transportFakeDevice) Neutralize() error {
	d.mu.Lock()
	d.neutralized++
	d.mu.Unlock()
	return nil
}

func (d *transportFakeDevice) Destroy() error           { d.mu.Lock(); d.destroyed++; d.mu.Unlock(); return nil }
func (d *transportFakeDevice) Syspath() (string, error) { return "fake", nil }

type transportFakeFactory struct {
	mu      sync.Mutex
	devices []*transportFakeDevice
}

func (f *transportFakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := &transportFakeDevice{}
	f.devices = append(f.devices, result)
	return result, nil
}

func TestTwoWebSocketClientsStayBoundToSeparateDevices(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &transportFakeFactory{}
	sess, err := session.New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	handler := input.NewHandler(sess)
	defer handler.Close()
	server := NewServer(sess, handler, library, 60)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	origin := httpServer.URL
	first := dialTransportClient(t, wsURL, origin, sess.Code())
	defer first.Close()
	firstWelcome := readWelcome(t, first)
	_ = readLayout(t, first)
	second := dialTransportClient(t, wsURL, origin, sess.Code())
	defer second.Close()
	secondWelcome := readWelcome(t, second)
	_ = readLayout(t, second)
	if firstWelcome.Slot == secondWelcome.Slot {
		t.Fatalf("both clients received slot %d", firstWelcome.Slot)
	}
	if err := first.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitSouth}).Encode()); err != nil {
		t.Fatal(err)
	}
	if err := second.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitEast}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	if len(devices) != 2 {
		t.Fatalf("device count = %d, want 2", len(devices))
	}
	devices[0].mu.Lock()
	firstStates := append([]uinput.State(nil), devices[0].states...)
	devices[0].mu.Unlock()
	devices[1].mu.Lock()
	secondStates := append([]uinput.State(nil), devices[1].states...)
	devices[1].mu.Unlock()
	if len(firstStates) == 0 || firstStates[len(firstStates)-1].Buttons != protocol.BitSouth {
		t.Fatalf("first device states = %+v", firstStates)
	}
	if len(secondStates) == 0 || secondStates[len(secondStates)-1].Buttons != protocol.BitEast {
		t.Fatalf("second device states = %+v", secondStates)
	}
}

type failingFactory struct{}

func (failingFactory) Create(device.RumbleFunc) (device.Device, error) {
	return nil, errors.New("no uinput available")
}

func TestDeviceErrorAdmissionFreesTheSlot(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := session.New(library, device.NewManager(failingFactory{}), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	handler := input.NewHandler(sess)
	defer handler.Close()
	server := NewServer(sess, handler, library, 60)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"

	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var message protocol.ErrorMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	if message.Code != "device_error" {
		t.Fatalf("error code = %q, want device_error", message.Code)
	}
	if players := sess.Players(); len(players) != 0 {
		t.Fatalf("failed admission left %d registered players behind", len(players))
	}
}

func dialTransportClient(t *testing.T, url, origin, code string) *websocket.Conn {
	t.Helper()
	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(url, map[string][]string{"Origin": {origin}})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(protocol.Hello{Type: protocol.MessageHello, SessionCode: code, ClientVersion: "test", Capabilities: protocol.Capabilities{}}); err != nil {
		t.Fatal(err)
	}
	return conn
}

func dialTransportClientWithReconnect(t *testing.T, url, origin, code, reconnectID string) *websocket.Conn {
	t.Helper()
	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(url, map[string][]string{"Origin": {origin}})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(protocol.Hello{Type: protocol.MessageHello, SessionCode: code, ReconnectID: reconnectID, ClientVersion: "test", Capabilities: protocol.Capabilities{}}); err != nil {
		t.Fatal(err)
	}
	return conn
}

func readWelcome(t *testing.T, conn *websocket.Conn) protocol.Welcome {
	t.Helper()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var welcome protocol.Welcome
	if err := json.Unmarshal(data, &welcome); err != nil {
		t.Fatal(err)
	}
	if welcome.Type != protocol.MessageWelcome {
		t.Fatalf("first response = %s", data)
	}
	return welcome
}

func readLayout(t *testing.T, conn *websocket.Conn) protocol.LayoutMessage {
	t.Helper()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var message protocol.LayoutMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != protocol.MessageLayout {
		t.Fatalf("second response = %s", data)
	}
	return message
}

func newTransportServer(t *testing.T) (*Server, *session.Session, *transportFakeFactory) {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &transportFakeFactory{}
	sess, err := session.New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	handler := input.NewHandler(sess)
	server := NewServer(sess, handler, library, 60)
	t.Cleanup(func() {
		handler.Close()
		server.Close()
		_ = sess.Close()
	})
	return server, sess, factory
}

func TestKickDeliversCloseMessageBeforeSocketClose(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	welcome := readWelcome(t, conn)
	_ = readLayout(t, conn)
	if err := sess.Kick(welcome.PlayerID); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("close message never arrived: %v", err)
	}
	var message protocol.CloseMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != protocol.MessageClose || message.Reason != "kicked" {
		t.Fatalf("got %s, want close/kicked", data)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("socket stayed open after the kick close message")
	}
}

func TestSessionResetBroadcastsToConnectedClients(t *testing.T) {
	server, sess, _ := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	_ = readWelcome(t, conn)
	_ = readLayout(t, conn)
	if err := sess.NewSession(); err != nil {
		t.Fatal(err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reset message never arrived: %v", err)
	}
	var message protocol.ResetMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != protocol.MessageReset {
		t.Fatalf("got %s, want session.reset", data)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("socket stayed open after the session reset")
	}
}

func waitForState(t *testing.T, sess *session.Session, id string, want session.PlayerState) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		player, ok := sess.Player(id)
		if ok && player.State == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	player, ok := sess.Player(id)
	t.Fatalf("player state = %v (ok=%v), want %s", player.State, ok, want)
}

func TestSixteenPlayersFillAllSlotsAndSeventeenthIsRejected(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	clients := make([]*websocket.Conn, 0, device.MaxSlots)
	for i := 0; i < device.MaxSlots; i++ {
		conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
		clients = append(clients, conn)
		welcome := readWelcome(t, conn)
		_ = readLayout(t, conn)
		if welcome.Slot != i {
			t.Fatalf("player %d slot = %d, want %d", i, welcome.Slot, i)
		}
	}
	defer func() {
		for _, c := range clients {
			c.Close()
		}
	}()
	seventeenth := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer seventeenth.Close()
	_, data, err := seventeenth.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var message protocol.ErrorMessage
	if err := json.Unmarshal(data, &message); err != nil {
		t.Fatal(err)
	}
	if message.Code != "session_full" {
		t.Fatalf("17th join error = %q, want session_full", message.Code)
	}
	factory.mu.Lock()
	count := len(factory.devices)
	factory.mu.Unlock()
	if count != device.MaxSlots {
		t.Fatalf("device count = %d, want %d", count, device.MaxSlots)
	}
}

func TestMoveRebindsDeviceAndRoutesInputToDestination(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	first := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer first.Close()
	firstWelcome := readWelcome(t, first)
	_ = readLayout(t, first)
	second := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer second.Close()
	_ = readWelcome(t, second)
	_ = readLayout(t, second)
	target := device.MaxSlots - 1
	if err := sess.Move(firstWelcome.PlayerID, target); err != nil {
		t.Fatal(err)
	}
	player, ok := sess.Player(firstWelcome.PlayerID)
	if !ok || player.Slot != target {
		t.Fatalf("player after move = slot %d, ok=%v", player.Slot, ok)
	}
	if err := first.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitSouth}).Encode()); err != nil {
		t.Fatal(err)
	}
	if err := second.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitEast}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	if len(devices) != 3 {
		t.Fatalf("move created %d devices, want 3 (old + second + destination)", len(devices))
	}
	devices[0].mu.Lock()
	firstDestroyed := devices[0].destroyed
	devices[0].mu.Unlock()
	devices[2].mu.Lock()
	movedStates := append([]uinput.State(nil), devices[2].states...)
	devices[2].mu.Unlock()
	devices[1].mu.Lock()
	secondStates := append([]uinput.State(nil), devices[1].states...)
	devices[1].mu.Unlock()
	if firstDestroyed == 0 {
		t.Fatal("old device was not destroyed during move")
	}
	if len(movedStates) == 0 || movedStates[len(movedStates)-1].Buttons != protocol.BitSouth {
		t.Fatalf("destination device states = %+v", movedStates)
	}
	if len(secondStates) == 0 || secondStates[len(secondStates)-1].Buttons != protocol.BitEast {
		t.Fatalf("second device states = %+v", secondStates)
	}
}

func TestReconnectReclaimsSlotAndInvalidatesOldSocket(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	first := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	welcome := readWelcome(t, first)
	_ = readLayout(t, first)
	original, ok := sess.Player(welcome.PlayerID)
	if !ok {
		t.Fatal("player missing before disconnect")
	}
	originalGeneration := original.Generation
	first.Close()
	waitForState(t, sess, welcome.PlayerID, session.StateDisconnectedGrace)
	reconnected := dialTransportClientWithReconnect(t, wsURL, httpServer.URL, sess.Code(), welcome.ReconnectID)
	defer reconnected.Close()
	reconnectWelcome := readWelcome(t, reconnected)
	_ = readLayout(t, reconnected)
	if reconnectWelcome.PlayerID != welcome.PlayerID {
		t.Fatalf("reconnect player = %q, want %q", reconnectWelcome.PlayerID, welcome.PlayerID)
	}
	if reconnectWelcome.Slot != welcome.Slot {
		t.Fatalf("reconnect slot = %d, want %d", reconnectWelcome.Slot, welcome.Slot)
	}
	player, ok := sess.Player(welcome.PlayerID)
	// Disconnect bumps the generation once, reconnect bumps it again.
	if !ok || player.Generation != originalGeneration+2 {
		t.Fatalf("generation = %d, want %d", player.Generation, originalGeneration+2)
	}
	factory.mu.Lock()
	count := len(factory.devices)
	factory.mu.Unlock()
	if count != 1 {
		t.Fatalf("reconnect created %d devices, want 1", count)
	}
	if err := reconnected.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitSouth}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	devices[0].mu.Lock()
	states := append([]uinput.State(nil), devices[0].states...)
	devices[0].mu.Unlock()
	if len(states) == 0 || states[len(states)-1].Buttons != protocol.BitSouth {
		t.Fatalf("reconnected device states = %+v", states)
	}
}

func TestWatchdogNeutralizesDisconnectedClientAndFrameRevivesIt(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	welcome := readWelcome(t, conn)
	_ = readLayout(t, conn)
	if err := conn.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 1, Buttons: protocol.BitSouth}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Second)
	player, ok := sess.Player(welcome.PlayerID)
	if !ok || player.State != session.StateStale {
		t.Fatalf("player after watchdog = state %v, ok=%v", player.State, ok)
	}
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	devices[0].mu.Lock()
	neutralized := devices[0].neutralized
	devices[0].mu.Unlock()
	if neutralized == 0 {
		t.Fatal("watchdog did not neutralize the device")
	}
	// Send a newer frame to revive.
	if err := conn.WriteMessage(websocket.BinaryMessage, (protocol.Frame{Seq: 2, Buttons: protocol.BitEast}).Encode()); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	player, ok = sess.Player(welcome.PlayerID)
	if !ok || player.State != session.StateActive {
		t.Fatalf("player after revive = state %v, ok=%v", player.State, ok)
	}
}

func TestLeaveFreesSlotAndDestroysDevice(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer conn.Close()
	welcome := readWelcome(t, conn)
	_ = readLayout(t, conn)
	// Send a message.Close text — the server's handleText calls session.Leave.
	if err := conn.WriteJSON(protocol.CloseMessage{Type: protocol.MessageClose}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	if _, ok := sess.Player(welcome.PlayerID); ok {
		t.Fatal("player still registered after leave")
	}
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	devices[0].mu.Lock()
	destroyed := devices[0].destroyed
	devices[0].mu.Unlock()
	if destroyed == 0 {
		t.Fatal("device was not destroyed after leave")
	}
	// A new join should reuse the freed slot.
	replacement := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
	defer replacement.Close()
	replacementWelcome := readWelcome(t, replacement)
	_ = readLayout(t, replacement)
	if replacementWelcome.Slot != welcome.Slot {
		t.Fatalf("replacement slot = %d, want %d", replacementWelcome.Slot, welcome.Slot)
	}
}

func TestShutdownDestroysAllDevices(t *testing.T) {
	server, sess, factory := newTransportServer(t)
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	clients := make([]*websocket.Conn, 0, 3)
	for i := 0; i < 3; i++ {
		conn := dialTransportClient(t, wsURL, httpServer.URL, sess.Code())
		clients = append(clients, conn)
		_ = readWelcome(t, conn)
		_ = readLayout(t, conn)
	}
	defer func() {
		for _, c := range clients {
			c.Close()
		}
	}()
	if err := sess.Close(); err != nil {
		t.Fatal(err)
	}
	factory.mu.Lock()
	devices := append([]*transportFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	for i, d := range devices {
		d.mu.Lock()
		destroyed := d.destroyed
		d.mu.Unlock()
		if destroyed == 0 {
			t.Fatalf("device %d was not destroyed", i)
		}
	}
}
