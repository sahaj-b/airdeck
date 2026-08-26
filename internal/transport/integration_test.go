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
	"github.com/sahaj-b/airdeck/internal/diagnostics"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type transportFakeDevice struct {
	mu     sync.Mutex
	states []uinput.State
}

func (d *transportFakeDevice) Apply(state uinput.State) error {
	d.mu.Lock()
	d.states = append(d.states, state)
	d.mu.Unlock()
	return nil
}
func (d *transportFakeDevice) Neutralize() error        { return nil }
func (d *transportFakeDevice) Destroy() error           { return nil }
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
	sess, err := session.New(library, device.NewManager(factory))
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	handler := input.NewHandler(sess, diagnostics.NewTrace(64), &diagnostics.Metrics{})
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
	sess, err := session.New(library, device.NewManager(failingFactory{}))
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	handler := input.NewHandler(sess, diagnostics.NewTrace(16), &diagnostics.Metrics{})
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
	sess, err := session.New(library, device.NewManager(factory))
	if err != nil {
		t.Fatal(err)
	}
	handler := input.NewHandler(sess, diagnostics.NewTrace(64), &diagnostics.Metrics{})
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
