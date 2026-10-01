//go:build windows

package vigem

import (
	"sync"
	"testing"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

func testClient(t *testing.T, fake *fakeDLL) *Client {
	t.Helper()
	c, err := Connect(fake.api())
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestWindowsConnectFailureSurfacesTypedError(t *testing.T) {
	fake := newFakeDLL()
	fake.connErr = VigemErrorBusNotFound
	if _, err := Connect(fake.api()); err == nil {
		t.Fatal("expected BUS_NOT_FOUND error")
	} else if err.Error() == "" {
		t.Fatal("typed error string is empty")
	}
}

func TestWindowsApplyOrderingAndDedupe(t *testing.T) {
	fake := newFakeDLL()
	client := testClient(t, fake)
	pad, err := NewPad(client, nil)
	if err != nil {
		t.Fatalf("NewPad: %v", err)
	}
	state := uinput.State{Buttons: uinput.BtnSouth, LX: 100, LY: 200, LT: 10}
	if err := pad.Apply(state); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	updates := 0
	for _, c := range fake.calls {
		if c.name == "update" {
			updates++
		}
	}
	if updates != 1 {
		t.Fatalf("updates after first Apply = %d, want 1", updates)
	}
	// Identical report must skip the DLL call.
	if err := pad.Apply(state); err != nil {
		t.Fatalf("Apply identical: %v", err)
	}
	updates = 0
	for _, c := range fake.calls {
		if c.name == "update" {
			updates++
		}
	}
	if updates != 1 {
		t.Fatalf("updates after identical Apply = %d, want still 1", updates)
	}
	if err := pad.Destroy(); err != nil {
		t.Fatalf("Destroy: %v", err)
	}
}

func TestWindowsRumbleScaling(t *testing.T) {
	fake := newFakeDLL()
	client := testClient(t, fake)
	var mu sync.Mutex
	var got []struct{ strong, weak uint16 }
	pad, err := NewPad(client, func(strong, weak uint16) {
		mu.Lock()
		got = append(got, struct{ strong, weak uint16 }{strong, weak})
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("NewPad: %v", err)
	}
	pad.notification(client.client, pad.target, 0xFF, 0x00, 0, 0)
	mu.Lock()
	if len(got) != 1 || got[0].strong != 0xFFFF || got[0].weak != 0x0000 {
		t.Fatalf("rumble (0xFF,0x00) -> %v, want (0xFFFF,0x0000)", got)
	}
	mu.Unlock()
	pad.notification(client.client, pad.target, 0, 0, 0, 0)
	mu.Lock()
	if len(got) != 2 || got[1].strong != 0 || got[1].weak != 0 {
		t.Fatalf("rumble stop -> %v, want (0,0)", got)
	}
	mu.Unlock()
}

func TestWindowsDestroyIdempotentAndApplyAfterDestroyNil(t *testing.T) {
	fake := newFakeDLL()
	client := testClient(t, fake)
	pad, err := NewPad(client, nil)
	if err != nil {
		t.Fatalf("NewPad: %v", err)
	}
	syspath, err := pad.Syspath()
	if err != nil {
		t.Fatalf("Syspath before Destroy: %v", err)
	}
	if syspath == "" {
		t.Fatal("Syspath is empty")
	}
	if err := pad.Destroy(); err != nil {
		t.Fatalf("first Destroy: %v", err)
	}
	if err := pad.Destroy(); err != nil {
		t.Fatalf("second Destroy: %v", err)
	}
	if err := pad.Apply(uinput.State{Buttons: uinput.BtnNorth}); err != nil {
		t.Fatalf("Apply after Destroy: %v", err)
	}
	if _, err := pad.Syspath(); err == nil {
		t.Fatal("Syspath after Destroy succeeded")
	}
}
