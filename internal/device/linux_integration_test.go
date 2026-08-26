//go:build linux

// Linux integration path: creates a real virtual controller through
// /dev/uinput, drives it through the device boundary, and verifies the
// kernel-visible event stream on the evdev node, including the force-feedback
// upload/playback handshake. Skipped when uinput is not usable on the host.
package device

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

const (
	evSyn = 0x00
	evKey = 0x01
	evAbs = 0x03
	evFF  = 0x15

	absX     = 0x00
	absY     = 0x01
	absZ     = 0x02
	absRX    = 0x03
	absRY    = 0x04
	absRZ    = 0x05
	absHat0X = 0x10
	absHat0Y = 0x11

	btnSouth  = 0x130
	btnEast   = 0x131
	btnNorth  = 0x133
	btnWest   = 0x134
	btnTL     = 0x136
	btnTR     = 0x137
	btnSelect = 0x13a
	btnStart  = 0x13b
	btnMode   = 0x13c
	btnThumbl = 0x13d
	btnThumbr = 0x13e

	ffRumble = 0x50

	// _IOW('E', 0x80, struct ff_effect)
	evioCsff = 0x40304580
)

type evdevEvent struct {
	Type  uint16
	Code  uint16
	Value int32
}

// ffEffect mirrors struct ff_effect; the Rumble union member lives at the
// same offset as in the uinput package (offset 16).
type ffEffect struct {
	Type      uint16
	ID        int16
	Direction uint16
	Trigger   [4]byte
	Replay    [4]byte
	_         [2]byte
	Rumble    struct{ Strong, Weak uint16 }
	_         [28]byte
}

type eventCollector struct {
	mu     sync.Mutex
	events []evdevEvent
	closed chan struct{}
}

func (c *eventCollector) run(file *os.File) {
	buf := make([]byte, 24*64)
	for {
		n, err := file.Read(buf)
		if err != nil {
			select {
			case <-c.closed:
				return
			default:
				return
			}
		}
		c.mu.Lock()
		for off := 0; off+24 <= n; off += 24 {
			c.events = append(c.events, evdevEvent{
				Type:  binary.LittleEndian.Uint16(buf[off+16:]),
				Code:  binary.LittleEndian.Uint16(buf[off+18:]),
				Value: int32(binary.LittleEndian.Uint32(buf[off+20:])),
			})
		}
		c.mu.Unlock()
	}
}

func (c *eventCollector) seen(predicate func(evdevEvent) bool) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, event := range c.events {
		if predicate(event) {
			return true
		}
	}
	return false
}

func (c *eventCollector) close() { close(c.closed) }

func waitFor(t *testing.T, timeout time.Duration, description string, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}

func findEventNode(syspath string) string {
	entries, err := os.ReadDir(syspath)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "event") {
			return filepath.Join("/dev/input", entry.Name())
		}
	}
	return ""
}

func ioctlErr(fd uintptr, cmd, arg uintptr) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, cmd, arg); errno != 0 {
		return errno
	}
	return nil
}

func writeEvdev(file *os.File, typ, code uint16, value int32) error {
	event := make([]byte, 24)
	binary.LittleEndian.PutUint16(event[16:], typ)
	binary.LittleEndian.PutUint16(event[18:], code)
	binary.LittleEndian.PutUint32(event[20:], uint32(value))
	_, err := file.Write(event)
	return err
}

func TestRealUinputDeviceDrivesEvdevAndRumble(t *testing.T) {
	probe, err := os.OpenFile("/dev/uinput", os.O_RDWR, 0)
	if err != nil {
		t.Skipf("uinput unavailable: %v", err)
	}
	probe.Close()

	var rumbleMu sync.Mutex
	var rumbles []string
	controller, err := UInputFactory{}.Create(func(strong, weak uint16) {
		rumbleMu.Lock()
		rumbles = append(rumbles, fmt.Sprintf("%d:%d", strong, weak))
		rumbleMu.Unlock()
	})
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	defer controller.Destroy()

	syspath, err := controller.Syspath()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(syspath, "/devices/virtual/input/") {
		t.Fatalf("unexpected syspath %q", syspath)
	}
	eventNode := findEventNode(syspath)
	if eventNode == "" {
		t.Skipf("no event node found under %s", syspath)
	}
	// The kernel creates the node as root:root; udev then flips the group to
	// input and logind grants the seat uaccess ACL asynchronously. Poll the
	// open so a fast test does not race that permission transition.
	var dev *os.File
	waitFor(t, 3*time.Second, "event node open", func() bool {
		f, err := os.OpenFile(eventNode, os.O_RDWR, 0)
		if err != nil {
			return false
		}
		dev = f
		return true
	})
	defer dev.Close()
	collector := &eventCollector{closed: make(chan struct{})}
	defer collector.close()
	go collector.run(dev)

	// One snapshot carrying every control: all digital bits, all four sticks,
	// both analog triggers, and a contradictory d-pad that must center the hat.
	var allButtons uint32 = uinput.BtnSouth | uinput.BtnEast | uinput.BtnWest | uinput.BtnNorth |
		uinput.BtnDPadUp | uinput.BtnDPadDown | uinput.BtnDPadLeft | uinput.BtnDPadRight |
		uinput.BtnLB | uinput.BtnRB | uinput.BtnLS | uinput.BtnRS |
		uinput.BtnStart | uinput.BtnBack | uinput.BtnGuide
	state := uinput.State{Buttons: allButtons, LX: 1234, LY: -5678, RX: 30000, RY: -30000, LT: 255, RT: 128}
	if err := controller.Apply(state); err != nil {
		t.Fatal(err)
	}
	expectButton := func(code uint16) {
		waitFor(t, time.Second, fmt.Sprintf("button %#x pressed", code), func() bool {
			return collector.seen(func(e evdevEvent) bool { return e.Type == evKey && e.Code == code && e.Value == 1 })
		})
	}
	for _, code := range []uint16{btnSouth, btnEast, btnNorth, btnWest, btnTL, btnTR, btnSelect, btnStart, btnMode, btnThumbl, btnThumbr} {
		expectButton(code)
	}
	expectAxis := func(code uint16, value int32) {
		waitFor(t, time.Second, fmt.Sprintf("axis %#x=%d", code, value), func() bool {
			return collector.seen(func(e evdevEvent) bool { return e.Type == evAbs && e.Code == code && e.Value == value })
		})
	}
	expectAxis(absX, 1234)
	expectAxis(absY, -5678)
	expectAxis(absRX, 30000)
	expectAxis(absRY, -30000)
	expectAxis(absZ, 255)
	expectAxis(absRZ, 128)
	// The contradictory d-pad keeps the hat centered, but the kernel drops
	// ABS events whose value matches the current value, so a first-time 0 is
	// never emitted. Assert the centered hat only after a real hat move.

	// A second snapshot with only right+up must move the hat to (1, -1).
	if err := controller.Apply(uinput.State{Buttons: uinput.BtnDPadRight | uinput.BtnDPadUp}); err != nil {
		t.Fatal(err)
	}
	expectAxis(absHat0X, 1)
	expectAxis(absHat0Y, -1)

	// A contradictory right+left+down+up snapshot re-centers both hat axes.
	if err := controller.Apply(uinput.State{Buttons: uinput.BtnDPadRight | uinput.BtnDPadLeft | uinput.BtnDPadUp | uinput.BtnDPadDown}); err != nil {
		t.Fatal(err)
	}
	expectAxis(absHat0X, 0)
	expectAxis(absHat0Y, 0)

	// Neutralization releases every button and re-centers sticks, triggers,
	// and the hat.
	if err := controller.Neutralize(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, time.Second, "all buttons released", func() bool {
		for _, code := range []uint16{btnSouth, btnEast, btnNorth, btnWest, btnTL, btnTR, btnSelect, btnStart, btnMode, btnThumbl, btnThumbr} {
			if !collector.seen(func(e evdevEvent) bool { return e.Type == evKey && e.Code == code && e.Value == 0 }) {
				return false
			}
		}
		return true
	})
	for _, code := range []uint16{absX, absY, absRX, absRY, absZ, absRZ} {
		expectAxis(code, 0)
	}

	// Force feedback: upload a rumble effect, play it, and stop it. The
	// kernel routes the upload handshake to the controller's reader, which
	// must complete it and then forward the playback magnitudes to the host.
	effect := ffEffect{Type: ffRumble, ID: -1}
	effect.Rumble.Strong, effect.Rumble.Weak = 40000, 12000
	if err := ioctlErr(dev.Fd(), evioCsff, uintptr(unsafe.Pointer(&effect))); err != nil {
		t.Fatalf("EVIOCSFF: %v", err)
	}
	if effect.ID < 0 {
		t.Fatalf("effect id = %d, want kernel-assigned id", effect.ID)
	}
	if err := writeEvdev(dev, evFF, uint16(effect.ID), 1); err != nil {
		t.Fatalf("play rumble: %v", err)
	}
	waitFor(t, 2*time.Second, "rumble callback with magnitudes", func() bool {
		rumbleMu.Lock()
		defer rumbleMu.Unlock()
		for _, entry := range rumbles {
			if entry == "40000:12000" {
				return true
			}
		}
		return false
	})
	if err := writeEvdev(dev, evFF, uint16(effect.ID), 0); err != nil {
		t.Fatalf("stop rumble: %v", err)
	}
	waitFor(t, 2*time.Second, "rumble stop callback", func() bool {
		rumbleMu.Lock()
		defer rumbleMu.Unlock()
		for _, entry := range rumbles {
			if entry == "0:0" {
				return true
			}
		}
		return false
	})
}

func TestRealUinputDeviceDestroyRemovesSyspath(t *testing.T) {
	probe, err := os.OpenFile("/dev/uinput", os.O_RDWR, 0)
	if err != nil {
		t.Skipf("uinput unavailable: %v", err)
	}
	probe.Close()
	controller, err := UInputFactory{}.Create(nil)
	if err != nil {
		t.Fatalf("create controller: %v", err)
	}
	syspath, err := controller.Syspath()
	if err != nil {
		t.Fatal(err)
	}
	if err := controller.Destroy(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 2*time.Second, "syspath removed after destroy", func() bool {
		_, statErr := os.Lstat(syspath)
		return os.IsNotExist(statErr)
	})
}
