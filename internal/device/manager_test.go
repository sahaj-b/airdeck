package device

import (
	"sync"
	"testing"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

type fakeDevice struct {
	mu        sync.Mutex
	applies   []uinput.State
	neutral   int
	destroyed int
}

func (d *fakeDevice) Apply(state uinput.State) error {
	d.mu.Lock()
	d.applies = append(d.applies, state)
	d.mu.Unlock()
	return nil
}

func (d *fakeDevice) Neutralize() error { d.mu.Lock(); d.neutral++; d.mu.Unlock(); return nil }

func (d *fakeDevice) Destroy() error           { d.mu.Lock(); d.destroyed++; d.mu.Unlock(); return nil }
func (d *fakeDevice) Syspath() (string, error) { return "fake", nil }

type fakeFactory struct {
	mu      sync.Mutex
	devices []*fakeDevice
}

func (f *fakeFactory) Create(RumbleFunc) (Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	device := &fakeDevice{}
	f.devices = append(f.devices, device)
	return device, nil
}

func TestManagerOwnsOneDevicePerSlot(t *testing.T) {
	factory := &fakeFactory{}
	manager := NewManager(factory)
	for slot := 0; slot < MaxSlots; slot++ {
		if err := manager.Create(slot, nil); err != nil {
			t.Fatalf("create slot %d: %v", slot, err)
		}
	}
	if err := manager.Create(0, nil); err != ErrSlotOccupied {
		t.Fatalf("duplicate create error = %v, want %v", err, ErrSlotOccupied)
	}
	if err := manager.Create(MaxSlots, nil); err == nil {
		t.Fatal("out-of-range slot was accepted")
	}
	if err := manager.Destroy(3); err != nil {
		t.Fatal(err)
	}
	if err := manager.Create(3, nil); err != nil {
		t.Fatal("destroyed slot was not reusable: ", err)
	}
	if err := manager.DestroyAll(); err != nil {
		t.Fatal(err)
	}
	factory.mu.Lock()
	count := len(factory.devices)
	factory.mu.Unlock()
	if count != MaxSlots+1 {
		t.Fatalf("factory created %d devices, want %d", count, MaxSlots+1)
	}
}
