package input

import (
	"sync"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type inputFakeDevice struct {
	mu      sync.Mutex
	neutral int
}

func (d *inputFakeDevice) Apply(uinput.State) error { return nil }
func (d *inputFakeDevice) Neutralize() error {
	d.mu.Lock()
	d.neutral++
	d.mu.Unlock()
	return nil
}
func (d *inputFakeDevice) Destroy() error           { return nil }
func (d *inputFakeDevice) Syspath() (string, error) { return "fake", nil }

type inputFakeFactory struct{ device *inputFakeDevice }

func (f *inputFakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	f.device = &inputFakeDevice{}
	return f.device, nil
}

func TestWatchdogMarksPlayerStaleAndNeutralizes(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &inputFakeFactory{}
	sess, err := session.New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	admission, err := sess.Admit(sess.Code(), "Player", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(sess)
	defer handler.Close()
	if err := handler.Handle(admission.Player.ID, admission.Player.Generation, protocol.Frame{Seq: 1}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(WatchdogTimeout + 100*time.Millisecond)
	for time.Now().Before(deadline) {
		player, ok := sess.Player(admission.Player.ID)
		if ok && player.State == session.StateStale {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	player, ok := sess.Player(admission.Player.ID)
	if !ok || player.State != session.StateStale {
		t.Fatalf("player after watchdog = %+v, ok=%v", player, ok)
	}
	factory.device.mu.Lock()
	neutral := factory.device.neutral
	factory.device.mu.Unlock()
	if neutral == 0 {
		t.Fatal("watchdog did not neutralize device")
	}
}

func TestHandlerRejectsStaleSequence(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &inputFakeFactory{}
	sess, err := session.New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	admission, err := sess.Admit(sess.Code(), "Player", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(sess)
	defer handler.Close()
	if err := handler.Handle(admission.Player.ID, admission.Player.Generation, protocol.Frame{Seq: 4}); err != nil {
		t.Fatal(err)
	}
	// second call with older sequence should be silently dropped (stale)
	if err := handler.Handle(admission.Player.ID, admission.Player.Generation, protocol.Frame{Seq: 3}); err != nil {
		t.Fatal(err)
	}
	// still active, stale frame did not move state
	player, _ := sess.Player(admission.Player.ID)
	if player.State != session.StateActive {
		t.Fatalf("player state = %v, want active after stale frame", player.State)
	}
}
