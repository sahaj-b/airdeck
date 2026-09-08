package uinput

import (
	"os"
	"syscall"
	"testing"
	"time"
)

// Destroy must return even when the read loop is parked with no events
// pending. Regression test: the loop used to sleep in the net poller past
// device teardown, so Destroy waited on loopDone forever and wedged session
// Close, which made SIGINT look like it did nothing.
func TestDestroyUnblocksParkedReadLoop(t *testing.T) {
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Skipf("socketpair unavailable: %v", err)
	}
	// Mirror production: a non-blocking fd whose reads park in the net
	// poller, and a peer that never sends, so no wakeup ever arrives.
	if err := syscall.SetNonblock(fds[0], true); err != nil {
		t.Fatal(err)
	}
	file := os.NewFile(uintptr(fds[0]), "uinput-test")
	peer := os.NewFile(uintptr(fds[1]), "uinput-test-peer")
	defer peer.Close()
	controller := newController(file, nil)
	go controller.readLoop()
	// Let the loop reach its parked read before tearing down. Without this
	// the loop can observe destroyed on its first check and exit without
	// ever blocking, which would pass even with the bug present.
	time.Sleep(500 * time.Millisecond)
	done := make(chan struct{})
	go func() {
		_ = controller.Destroy()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Destroy did not return while the read loop was parked without events")
	}
}

func TestHatFrom(t *testing.T) {
	cases := []struct {
		buttons uint32
		x, y    int32
	}{
		{0, 0, 0},
		{BtnDPadUp, 0, -1},
		{BtnDPadDown, 0, 1},
		{BtnDPadLeft, -1, 0},
		{BtnDPadRight, 1, 0},
		{BtnDPadUp | BtnDPadRight, 1, -1},
		{BtnDPadLeft | BtnDPadDown, -1, 1},
		// opposite directions cancel like real hats
		{BtnDPadUp | BtnDPadDown, 0, 0},
	}
	for _, c := range cases {
		x, y := hatFrom(c.buttons)
		if x != c.x || y != c.y {
			t.Errorf("hatFrom(%#x) = (%d,%d), want (%d,%d)", c.buttons, x, y, c.x, c.y)
		}
	}
}

func keyEvents(events []rawEvent) map[uint16]int32 {
	out := map[uint16]int32{}
	for _, ev := range events {
		if ev.typ == evKey {
			out[ev.code] = ev.value
		}
	}
	return out
}

func absValues(events []rawEvent) map[uint16]int32 {
	out := map[uint16]int32{}
	for _, ev := range events {
		if ev.typ == evAbs {
			out[ev.code] = ev.value
		}
	}
	return out
}

func TestDiffStateFirstApplyEmitsEverything(t *testing.T) {
	s := State{Buttons: BtnSouth | BtnDPadUp | BtnGuide, LX: -32768, LT: 255}
	events := diffState(Neutral, s, false)

	keys := keyEvents(events)
	for _, b := range buttonCodes {
		want := int32(0)
		if s.Buttons&b.mask != 0 {
			want = 1
		}
		if got := keys[b.code]; got != want {
			t.Errorf("button code %#x = %d, want %d", b.code, got, want)
		}
	}
	abs := absValues(events)
	if abs[absX] != -stickMax {
		t.Errorf("LX clamped to %d, want %d", abs[absX], -stickMax)
	}
	if abs[absHat0Y] != -1 {
		t.Errorf("hat Y = %d, want -1", abs[absHat0Y])
	}
	if abs[absZ] != 255 {
		t.Errorf("LT = %d, want 255", abs[absZ])
	}
}

func TestDiffStateOnlyChanged(t *testing.T) {
	prev := State{Buttons: BtnSouth, LX: 100, RT: 10}
	next := State{Buttons: BtnSouth, LX: 200, RT: 10}
	events := diffState(prev, next, true)
	if len(events) != 1 || events[0].typ != evAbs || events[0].code != absX || events[0].value != 200 {
		t.Errorf("expected single ABS_X=200 event, got %+v", events)
	}
}

func TestDiffStateNeutralize(t *testing.T) {
	prev := State{Buttons: ^uint32(0), LX: 1000, LY: -1000, RX: 5, RY: 5, LT: 9, RT: 9}
	events := diffState(prev, Neutral, true)
	if len(events) == 0 {
		t.Fatal("neutralize from held state emitted nothing")
	}
	for _, ev := range events {
		if ev.typ == evKey && ev.value != 0 {
			t.Errorf("release event with value %d", ev.value)
		}
	}
	if events := diffState(Neutral, Neutral, true); len(events) != 0 {
		t.Errorf("re-neutralizing emitted %+v", events)
	}
}

func TestButtonBitsUniqueAndMapped(t *testing.T) {
	seen := uint32(0)
	for _, b := range buttonCodes {
		if seen&b.mask != 0 {
			t.Fatalf("duplicate mask %#x in buttonCodes", b.mask)
		}
		seen |= b.mask
	}
	// D-pad bits are hat axes, everything else must be a key:
	// face 0-3, shoulders/clicks 8-11, Start/Back/Guide 12-14.
	const expected = uint32(0x7f0f)
	if seen != expected {
		t.Errorf("buttonCodes covers %#x, expected all non-dpad bits below 16", seen)
	}
}
