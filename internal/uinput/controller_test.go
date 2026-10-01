//go:build linux

package uinput

import (
	"fmt"
	"os"
	"sync"
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

type rumbleRec struct {
	mu    sync.Mutex
	calls []string
}

func (r *rumbleRec) callback(strong, weak uint16) {
	r.mu.Lock()
	r.calls = append(r.calls, fmt.Sprintf("%d:%d", strong, weak))
	r.mu.Unlock()
}

func (r *rumbleRec) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string{}, r.calls...)
}

func (r *rumbleRec) saw(want string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.calls {
		if c == want {
			return true
		}
	}
	return false
}

func waitForRumble(t *testing.T, rec *rumbleRec, want string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if rec.saw(want) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for rumble %q, got %v", want, rec.snapshot())
}

func newRumbleTestController(rec *rumbleRec) *Controller {
	// No read loop, no fd use: these tests drive the effect state machine
	// directly. Never call Destroy here (it ioctls the nil file).
	return newController(nil, rec.callback)
}

// Finite-length effects must synthesize their own stop: games upload
// replay length/delay and play N times without an explicit stop, and the
// kernel stops internally without notifying the creator.
func TestTimedEffectAutoStops(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[7] = effectInfo{strong: 1000, weak: 2000, length: 30}
	c.fireEffect(7, 1)
	waitForRumble(t, rec, "1000:2000")
	waitForRumble(t, rec, "0:0")
}

// delay + length*count defines the hold: delay 20 + 30*2 = 80ms.
func TestTimedEffectUsesDelayAndPlayCount(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[7] = effectInfo{strong: 100, weak: 100, length: 30, delay: 20}
	c.fireEffect(7, 2)
	waitForRumble(t, rec, "100:100")
	time.Sleep(40 * time.Millisecond)
	if rec.saw("0:0") {
		t.Fatalf("stopped early, got %v", rec.snapshot())
	}
	waitForRumble(t, rec, "0:0")
}

// Zero length means infinite: hold until an explicit stop.
func TestInfiniteEffectHoldsUntilExplicitStop(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[7] = effectInfo{strong: 500, weak: 600}
	c.fireEffect(7, 1)
	waitForRumble(t, rec, "500:600")
	time.Sleep(100 * time.Millisecond)
	if rec.saw("0:0") {
		t.Fatalf("infinite effect stopped itself, got %v", rec.snapshot())
	}
	c.fireEffect(7, 0)
	waitForRumble(t, rec, "0:0")
}

// Removing an effect stops it if it was playing; the kernel sends no stop
// event for that, so erase must forward the remainder itself.
func TestErasePlayingEffectStops(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[5] = effectInfo{strong: 900, weak: 100}
	c.fireEffect(5, 1)
	waitForRumble(t, rec, "900:100")
	c.eraseEffect(5)
	waitForRumble(t, rec, "0:0")
	if _, ok := c.effects[5]; ok {
		t.Fatal("erased effect still registered")
	}
}

// Overlapping effects combine by max and hold until the last one ends.
func TestOverlappingEffectsCombine(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[1] = effectInfo{strong: 5000}
	c.effects[2] = effectInfo{weak: 3000}
	c.fireEffect(1, 1)
	waitForRumble(t, rec, "5000:0")
	c.fireEffect(2, 1)
	waitForRumble(t, rec, "5000:3000")
	c.fireEffect(1, 0)
	waitForRumble(t, rec, "0:3000")
	if rec.saw("0:0") {
		t.Fatalf("first stop killed the survivor, got %v", rec.snapshot())
	}
	c.fireEffect(2, 0)
	waitForRumble(t, rec, "0:0")
}

// Re-playing re-arms the auto-stop instead of letting the stale timer cut
// the new play short.
func TestReplayRearmsAutoStop(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.effects[7] = effectInfo{strong: 100, weak: 0, length: 100}
	c.fireEffect(7, 1)
	waitForRumble(t, rec, "100:0")
	time.Sleep(50 * time.Millisecond)
	c.fireEffect(7, 1)
	time.Sleep(70 * time.Millisecond) // past the first deadline, before the second
	if rec.saw("0:0") {
		t.Fatalf("stale timer cut the replay short, got %v", rec.snapshot())
	}
	waitForRumble(t, rec, "0:0")
}

func TestUnknownEffectIsIgnored(t *testing.T) {
	rec := &rumbleRec{}
	c := newRumbleTestController(rec)
	c.fireEffect(99, 1)
	c.fireEffect(99, 0)
	c.eraseEffect(99)
	time.Sleep(50 * time.Millisecond)
	if got := rec.snapshot(); len(got) != 0 {
		t.Fatalf("unknown effect emitted %v", got)
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
