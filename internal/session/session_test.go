package session

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type sessionFakeDevice struct {
	mu        sync.Mutex
	states    []uinput.State
	neutral   int
	destroyed int
}

func (d *sessionFakeDevice) Apply(state uinput.State) error {
	d.mu.Lock()
	d.states = append(d.states, state)
	d.mu.Unlock()
	return nil
}

func (d *sessionFakeDevice) Neutralize() error { d.mu.Lock(); d.neutral++; d.mu.Unlock(); return nil }

func (d *sessionFakeDevice) Destroy() error           { d.mu.Lock(); d.destroyed++; d.mu.Unlock(); return nil }
func (d *sessionFakeDevice) Syspath() (string, error) { return "fake", nil }

type sessionFakeFactory struct {
	mu      sync.Mutex
	devices []*sessionFakeDevice
}

func (f *sessionFakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &sessionFakeDevice{}
	f.devices = append(f.devices, d)
	return d, nil
}

func newTestSession(t *testing.T) (*Session, *sessionFakeFactory) {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &sessionFakeFactory{}
	session, err := New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	return session, factory
}

func newTwoLayoutSession(t *testing.T) *Session {
	t.Helper()
	builtin, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	original, ok := builtin.Get("xbox-default")
	if !ok {
		t.Fatal("built-in layout missing")
	}
	alternative := original
	alternative.ID = "alt-default"
	alternative.Name = "Alternative"
	library, err := layout.NewLibrary([]layout.Document{original, alternative}, "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	session, err := New(library, device.NewManager(&sessionFakeFactory{}), 0)
	if err != nil {
		t.Fatal(err)
	}
	return session
}

func TestKickSendsCloseMessageBeforeFreeingSlot(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	var sent []any
	closed := false
	send := func(value any) error { sent = append(sent, value); return nil }
	close := func() { closed = true }
	admission, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, send, close)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Kick(admission.Player.ID); err != nil {
		t.Fatal(err)
	}
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want exactly one close message", len(sent))
	}
	message, ok := sent[0].(protocol.CloseMessage)
	if !ok || message.Reason != "kicked" {
		t.Fatalf("sent = %#v, want close message with reason kicked", sent[0])
	}
	if !closed {
		t.Fatal("close callback was not invoked")
	}
}

func TestSetLayoutPushesDocumentToPlayer(t *testing.T) {
	session := newTwoLayoutSession(t)
	defer session.Close()
	var sent []any
	send := func(value any) error { sent = append(sent, value); return nil }
	admission, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, send, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.SetLayout(admission.Player.ID, "alt-default"); err != nil {
		t.Fatal(err)
	}
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want one layout message", len(sent))
	}
	message, ok := sent[0].(protocol.LayoutMessage)
	if !ok || message.ID != "alt-default" {
		t.Fatalf("sent = %#v, want layout alt-default", sent[0])
	}
	if player, ok := session.Player(admission.Player.ID); !ok || player.LayoutID != "alt-default" {
		t.Fatalf("player layout = %+v, ok=%v", player, ok)
	}
}

func TestSetDefaultLayoutChangesAdmissionDefault(t *testing.T) {
	session := newTwoLayoutSession(t)
	defer session.Close()
	if err := session.SetDefaultLayout("alt-default"); err != nil {
		t.Fatal(err)
	}
	admission, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if admission.Player.LayoutID != "alt-default" {
		t.Fatalf("admitted layout = %q, want alt-default", admission.Player.LayoutID)
	}
}

func TestNewSessionEmitsResetBeforeClosingPlayers(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	var order []string
	unsubscribe := session.Subscribe(func(event Event) {
		if event.Type == "session.reset" {
			order = append(order, "reset")
		}
	})
	defer unsubscribe()
	close := func() { order = append(order, "close") }
	if _, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, nil, close); err != nil {
		t.Fatal(err)
	}
	if err := session.NewSession(); err != nil {
		t.Fatal(err)
	}
	want := []string{"reset", "close"}
	if len(order) != len(want) || order[0] != "reset" || order[1] != "close" {
		t.Fatalf("order = %v, want %v", order, want)
	}
}

func TestAdmissionCeilingAndSlotReuse(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	players := make([]Admission, 0, maxPlayers)
	for i := 0; i < maxPlayers; i++ {
		admission, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, nil, nil)
		if err != nil {
			t.Fatalf("admit player %d: %v", i, err)
		}
		players = append(players, admission)
		if admission.Player.Slot != i {
			t.Fatalf("slot = %d, want %d", admission.Player.Slot, i)
		}
	}
	if _, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, nil, nil); !errors.Is(err, ErrSessionFull) {
		t.Fatalf("17th admission error = %v", err)
	}
	if err := session.Kick(players[0].Player.ID); err != nil {
		t.Fatal(err)
	}
	admission, err := session.Admit(session.Code(), "", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if admission.Player.Slot != 0 {
		t.Fatalf("reused slot = %d, want 0", admission.Player.Slot)
	}
}

func TestReconnectInvalidatesOldGeneration(t *testing.T) {
	session, factory := newTestSession(t)
	defer session.Close()
	admission, err := session.Admit(session.Code(), "Player", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Disconnect(admission.Player.ID, admission.Player.Generation); err != nil {
		t.Fatal(err)
	}
	reconnected, err := session.Admit(session.Code(), "", admission.Player.ReconnectID, "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reconnected.Reconnected || reconnected.Player.Generation == admission.Player.Generation {
		t.Fatal("reconnect did not create a new generation")
	}
	frame := protocol.Frame{Seq: 1}
	if err := session.ApplyInput(admission.Player.ID, admission.Player.Generation, frame); !errors.Is(err, ErrGeneration) {
		t.Fatalf("old generation apply error = %v", err)
	}
	if err := session.ApplyInput(reconnected.Player.ID, reconnected.Player.Generation, frame); err != nil {
		t.Fatal(err)
	}
	factory.mu.Lock()
	devices := append([]*sessionFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	if len(devices) != 1 {
		t.Fatalf("reconnect created %d devices, want 1", len(devices))
	}
}

func TestLastInputOnlyUpdatesOnNonNeutralFrames(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	admission, err := session.Admit(session.Code(), "Player", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	playerID := admission.Player.ID
	generation := admission.Player.Generation

	// Neutral frame should not update LastInput.
	before := admission.Player.LastInput
	if err := session.ApplyInput(playerID, generation, protocol.Frame{Seq: 1}); err != nil {
		t.Fatal(err)
	}
	snapshot, ok := session.Player(playerID)
	if !ok {
		t.Fatal("player not found")
	}
	if snapshot.LastInput != before {
		t.Fatal("neutral frame should not update LastInput")
	}

	// Non-neutral frame should update LastInput.
	if err := session.ApplyInput(playerID, generation, protocol.Frame{Seq: 2, Buttons: protocol.BitSouth}); err != nil {
		t.Fatal(err)
	}
	snapshot, ok = session.Player(playerID)
	if !ok {
		t.Fatal("player not found")
	}
	if snapshot.LastInput == before {
		t.Fatal("non-neutral frame should update LastInput")
	}
}

func TestMoveChangesOwnershipWithoutCreatingSeventeenthDevice(t *testing.T) {
	session, factory := newTestSession(t)
	defer session.Close()
	admission, err := session.Admit(session.Code(), "Player", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Move(admission.Player.ID, 4); err != nil {
		t.Fatal(err)
	}
	player, ok := session.Player(admission.Player.ID)
	if !ok || player.Slot != 4 {
		t.Fatalf("moved player = %+v, ok=%v", player, ok)
	}
	factory.mu.Lock()
	devices := append([]*sessionFakeDevice(nil), factory.devices...)
	factory.mu.Unlock()
	if len(devices) != 2 {
		t.Fatalf("move created %d devices, want two sequential creations", len(devices))
	}
	if devices[0].destroyed == 0 {
		t.Fatal("old device was not destroyed during move")
	}
}

func TestAdmitHonorsCodeRequiredToggle(t *testing.T) {
	session, _ := newTestSession(t)
	if _, err := session.Admit("", "", "", "", protocol.Capabilities{}, func(any) error { return nil }, func() {}); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("expected ErrInvalidCode with empty code, got %v", err)
	}
	session.SetCodeRequired(false)
	admission, err := session.Admit("", "", "", "", protocol.Capabilities{}, func(any) error { return nil }, func() {})
	if err != nil {
		t.Fatal(err)
	}
	if admission.Reconnected {
		t.Fatal("expected a fresh admission, not a reconnect")
	}
}

func TestCustomGracePeriodFreesSlotAfterExpiry(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &sessionFakeFactory{}
	sess, err := New(library, device.NewManager(factory), 10*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	admission, err := sess.Admit(sess.Code(), "Player", "", "", protocol.Capabilities{}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := sess.Disconnect(admission.Player.ID, admission.Player.Generation); err != nil {
		t.Fatal(err)
	}
	slot := admission.Player.Slot
	if sess.slots[slot] == nil {
		t.Fatal("slot should be reserved during grace")
	}
	time.Sleep(50 * time.Millisecond)
	if sess.slots[slot] != nil {
		t.Fatal("slot should be free after grace expiry")
	}
	factory.mu.Lock()
	destroyed := factory.devices[0].destroyed
	factory.mu.Unlock()
	if destroyed == 0 {
		t.Fatal("device should be destroyed after grace expiry")
	}
}
