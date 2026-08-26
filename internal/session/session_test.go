package session

import (
	"errors"
	"sync"
	"testing"

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
	session, err := New(library, device.NewManager(factory))
	if err != nil {
		t.Fatal(err)
	}
	return session, factory
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
