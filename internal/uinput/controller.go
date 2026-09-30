//go:build linux

package uinput

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// ffDebug enables verbose force-feedback logging via AIRDECK_FF_DEBUG=1.
// Upload/play/stop/timeout/erase are rare (unlike input frames), so this is
// safe to leave on during a repro session.
var ffDebug = os.Getenv("AIRDECK_FF_DEBUG") != ""

func ffLog(format string, args ...any) {
	if ffDebug {
		log.Printf("ff: "+format, args...)
	}
}

var buttonCodes = []struct {
	mask uint32
	code uint16
}{
	{BtnSouth, btnSouth},
	{BtnEast, btnEast},
	{BtnWest, btnWest},
	{BtnNorth, btnNorth},
	{BtnLB, btnTL},
	{BtnRB, btnTR},
	{BtnLS, btnThumbl},
	{BtnRS, btnThumbr},
	{BtnStart, btnStart},
	{BtnBack, btnSelect},
	{BtnGuide, btnMode},
}

type Config struct {
	// Path to the uinput control device. Defaults to /dev/uinput.
	Path string
	// Device name shown in /proc/bus/input/devices. Defaults to
	// "Xbox 360 Controller". Identity comes from the hardcoded Microsoft
	// vendor/product IDs, not the name.
	Name string
	// Rumble is called from an internal goroutine when a game starts or
	// stops a rumble effect. Zero magnitudes mean stop. It must not block;
	// slow callbacks delay the device's event loop.
	//
	// Finite-length effects auto-stop: games routinely upload an effect with
	// replay length/delay and play it N times without ever writing an
	// explicit stop, and the kernel stops it internally without notifying
	// the creator. The controller synthesizes the stop from the uploaded
	// timing so those effects do not buzz forever.
	Rumble func(strong, weak uint16)
}

// effectInfo is the host-side copy of an uploaded rumble effect. Replay
// carries the effect's own timing: delay before it kicks in plus length per
// play. Without it a finite pulse looks identical to a held rumble.
type effectInfo struct {
	strong uint16
	weak   uint16
	length uint16
	delay  uint16
}

// maxTimedEffectMs bounds synthesized rumble stops. Absurd play counts
// (SDL_HAPTIC_INFINITY arrives as a negative value) and overlong totals
// mean "hold until an explicit stop", same as an infinite-length effect.
const maxTimedEffectMs = 5 * 60 * 1000

type Controller struct {
	file   *os.File
	rumble func(strong, weak uint16)

	effects map[int16]effectInfo
	// playing is the set of effect ids currently held, each with the
	// generation of the play that started it, so a stale auto-stop timer
	// cannot kill a newer play of the same id.
	playing map[int16]uint64
	timers  map[int16]*time.Timer
	gen     uint64
	// lastStrong/lastWeak is the last pair forwarded to rumble, so effect
	// replays and overlapping effects only emit on actual change.
	lastStrong uint16
	lastWeak   uint16

	mu        sync.Mutex
	writeMu   sync.Mutex
	last      State
	started   bool
	destroyed bool
	destroy   sync.Once
	loopDone  chan struct{}
}

const stickMax = 32767

func NewController(cfg Config) (*Controller, error) {
	path := cfg.Path
	if path == "" {
		path = "/dev/uinput"
	}
	name := cfg.Name
	if name == "" {
		name = "Xbox 360 Controller"
	}

	// Non-blocking so Destroy can interrupt the rumble read loop.
	f, err := os.OpenFile(path, os.O_RDWR|syscall.O_NONBLOCK, 0o660)
	if err != nil {
		return nil, fmt.Errorf("uinput: open %s: %w", path, err)
	}
	c := newController(f, cfg.Rumble)
	if err := c.setup(name); err != nil {
		f.Close()
		return nil, err
	}
	go c.readLoop()
	return c, nil
}

// newController builds a Controller around an already-open file without
// touching kernel ioctls, so tests can drive the read loop and Destroy
// against a socketpair instead of /dev/uinput.
func newController(f *os.File, rumble func(strong, weak uint16)) *Controller {
	return &Controller{
		file:     f,
		rumble:   rumble,
		effects:  make(map[int16]effectInfo),
		playing:  make(map[int16]uint64),
		timers:   make(map[int16]*time.Timer),
		loopDone: make(chan struct{}),
	}
}

func (c *Controller) setup(name string) error {
	setBit := func(cmd uintptr, bit uintptr) error {
		if err := ioctl(c.file, cmd, bit); err != nil {
			return fmt.Errorf("uinput: set bit %#x: %w", bit, err)
		}
		return nil
	}
	if err := setBit(uiSetEvBit, evKey); err != nil {
		return err
	}
	for _, b := range buttonCodes {
		if err := setBit(uiSetKeyBit, uintptr(b.code)); err != nil {
			return err
		}
	}
	if err := setBit(uiSetEvBit, evAbs); err != nil {
		return err
	}
	for _, axis := range []uintptr{absX, absY, absRX, absRY, absZ, absRZ, absHat0X, absHat0Y} {
		if err := setBit(uiSetAbsBit, axis); err != nil {
			return err
		}
	}
	if err := setBit(uiSetEvBit, evFF); err != nil {
		return err
	}
	if err := setBit(uiSetFFBit, ffRumble); err != nil {
		return err
	}

	dev := uinputUserDev{
		ID:        xbox360ID,
		FfEffects: 4,
		Absmax:    [absCnt]int32{absX: stickMax, absY: stickMax, absRX: stickMax, absRY: stickMax, absZ: 255, absRZ: 255, absHat0X: 1, absHat0Y: 1},
		Absmin:    [absCnt]int32{absX: -stickMax, absY: -stickMax, absRX: -stickMax, absRY: -stickMax, absHat0X: -1, absHat0Y: -1},
	}
	copy(dev.Name[:], name)

	var buf bytes.Buffer
	if err := binary.Write(&buf, binary.LittleEndian, dev); err != nil {
		return fmt.Errorf("uinput: encode device setup: %w", err)
	}
	if err := c.writeBytes(buf.Bytes()); err != nil {
		return fmt.Errorf("uinput: write device setup: %w", err)
	}
	if err := ioctl(c.file, uiDevCreate, 0); err != nil {
		return fmt.Errorf("uinput: create device: %w", err)
	}
	return nil
}

// Syspath returns the device's sysfs directory (e.g.
// /sys/devices/virtual/input/input42) for diagnostics.
func (c *Controller) Syspath() (string, error) {
	var buf [65]byte
	if err := ioctl(c.file, uiGetSysname, uintptr(unsafe.Pointer(&buf[0]))); err != nil {
		return "", fmt.Errorf("uinput: query sysname: %w", err)
	}
	name := ""
	for i, b := range buf {
		if b == 0 {
			name = string(buf[:i])
			break
		}
	}
	if name == "" {
		return "", errors.New("uinput: empty sysname")
	}
	return "/sys/devices/virtual/input/" + name, nil
}

// Apply writes only the events needed to move the device from its previous
// snapshot to s, followed by one SYN report. After Destroy it is a no-op, so
// watchdog neutralization can safely race slot teardown.
func (c *Controller) Apply(s State) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	c.mu.Lock()
	if c.destroyed {
		c.mu.Unlock()
		return nil
	}
	events := diffState(c.last, s, c.started)
	c.mu.Unlock()

	deadline := time.Now().Add(writeTimeout)
	for _, ev := range events {
		if err := c.writeEvent(ev.typ, ev.code, ev.value, deadline); err != nil {
			return fmt.Errorf("uinput: write event: %w", err)
		}
	}
	if len(events) > 0 {
		if err := c.writeSyn(deadline); err != nil {
			return fmt.Errorf("uinput: write syn: %w", err)
		}
	}

	c.mu.Lock()
	if !c.destroyed {
		c.last = s
		c.started = true
	}
	c.mu.Unlock()
	return nil
}

// Neutralize releases every control. Cheap when the state is already neutral.
func (c *Controller) Neutralize() error {
	return c.Apply(Neutral)
}

type rawEvent struct {
	typ   uint16
	code  uint16
	value int32
}

func clampStick(v int16) int32 {
	if v < -stickMax {
		return -stickMax
	}
	return int32(v)
}

func hatFrom(buttons uint32) (x, y int32) {
	// Contradictory directions center the axis instead of picking a winner.
	switch {
	case buttons&BtnDPadRight != 0 && buttons&BtnDPadLeft == 0:
		x = 1
	case buttons&BtnDPadLeft != 0 && buttons&BtnDPadRight == 0:
		x = -1
	}
	switch {
	case buttons&BtnDPadDown != 0 && buttons&BtnDPadUp == 0:
		y = 1
	case buttons&BtnDPadUp != 0 && buttons&BtnDPadDown == 0:
		y = -1
	}
	return x, y
}

func diffState(prev, next State, started bool) []rawEvent {
	var events []rawEvent

	if changed := prev.Buttons ^ next.Buttons; changed != 0 || !started {
		for _, b := range buttonCodes {
			if changed&b.mask == 0 && started {
				continue
			}
			value := int32(0)
			if next.Buttons&b.mask != 0 {
				value = 1
			}
			events = append(events, rawEvent{evKey, b.code, value})
		}
		px, py := hatFrom(prev.Buttons)
		nx, ny := hatFrom(next.Buttons)
		if nx != px || !started {
			events = append(events, rawEvent{evAbs, absHat0X, nx})
		}
		if ny != py || !started {
			events = append(events, rawEvent{evAbs, absHat0Y, ny})
		}
	}

	pairs := [][2]int16{{prev.LX, next.LX}, {prev.LY, next.LY}, {prev.RX, next.RX}, {prev.RY, next.RY}}
	codes := []uint16{absX, absY, absRX, absRY}
	for i, p := range pairs {
		if p[0] != p[1] || !started {
			events = append(events, rawEvent{evAbs, codes[i], clampStick(p[1])})
		}
	}

	triggers := [][2]uint8{{prev.LT, next.LT}, {prev.RT, next.RT}}
	trigCodes := []uint16{absZ, absRZ}
	for i, t := range triggers {
		if t[0] != t[1] || !started {
			events = append(events, rawEvent{evAbs, trigCodes[i], int32(t[1])})
		}
	}
	return events
}

func (c *Controller) writeEvent(typ, code uint16, value int32, deadline time.Time) error {
	var buf [inputEventSize]byte
	binary.LittleEndian.PutUint16(buf[16:18], typ)
	binary.LittleEndian.PutUint16(buf[18:20], code)
	binary.LittleEndian.PutUint32(buf[20:24], uint32(value))
	return c.writeBytesUntil(buf[:], deadline)
}

func (c *Controller) writeSyn(deadline time.Time) error {
	var buf [inputEventSize]byte
	binary.LittleEndian.PutUint16(buf[16:18], evSyn)
	binary.LittleEndian.PutUint16(buf[18:20], synReport)
	return c.writeBytesUntil(buf[:], deadline)
}

func (c *Controller) writeBytes(data []byte) error {
	return c.writeBytesUntil(data, time.Now().Add(writeTimeout))
}

func (c *Controller) writeBytesUntil(data []byte, deadline time.Time) error {
	for len(data) > 0 {
		// The device fd is non-blocking, so Go parks writes in the net
		// poller instead of returning EAGAIN. The write deadline bounds
		// that wait; without it a full kernel buffer parks us forever.
		if err := c.file.SetWriteDeadline(deadline); err != nil {
			return err
		}
		n, err := c.file.Write(data)
		if n > 0 {
			data = data[n:]
		}
		if len(data) == 0 {
			return nil
		}
		if err == nil {
			if n == 0 {
				return io.ErrShortWrite
			}
			continue
		}
		if errors.Is(err, syscall.EINTR) {
			continue
		}
		if errors.Is(err, os.ErrDeadlineExceeded) {
			return errors.New("uinput: write timed out")
		}
		return err
	}
	return nil
}

const (
	writeTimeout = 500 * time.Millisecond
	// readTimeout bounds each read so the loop re-checks destroyed even
	// when the kernel never delivers another event.
	readTimeout = 200 * time.Millisecond
	// destroyWaitTimeout bounds Destroy's wait for the read loop. The loop
	// always wakes within readTimeout, so hitting this means the kernel is
	// wedged; shutdown must not hang forever behind it.
	destroyWaitTimeout = 2 * time.Second
)

func (c *Controller) readLoop() {
	defer close(c.loopDone)
	buf := make([]byte, inputEventSize*16)
	for {
		c.mu.Lock()
		done := c.destroyed
		c.mu.Unlock()
		if done {
			return
		}
		// Reads on the non-blocking fd park in the Go net poller instead
		// of returning EAGAIN, and a destroyed device delivers no more
		// wakeups. The deadline forces a periodic re-check of destroyed
		// so Destroy can never wait on this loop forever.
		if err := c.file.SetReadDeadline(time.Now().Add(readTimeout)); err != nil {
			return // closed by Destroy; nothing left to serve
		}
		n, err := c.file.Read(buf)
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) || errors.Is(err, syscall.EAGAIN) || errors.Is(err, syscall.EINTR) {
				continue
			}
			return // device destroyed or kernel error; nothing left to serve
		}
		c.mu.Lock()
		done = c.destroyed
		c.mu.Unlock()
		if done {
			// Destroy closed in on us; drop late events instead of
			// issuing ioctls on a stale fd.
			return
		}
		for off := 0; off+inputEventSize <= n; off += inputEventSize {
			var ev inputEvent
			if err := binary.Read(bytes.NewReader(buf[off:off+inputEventSize]), binary.LittleEndian, &ev); err != nil {
				continue
			}
			switch ev.Type {
			case evUinput:
				c.handleUinput(ev.Code, ev.Value)
			case evFF:
				c.fireEffect(int16(ev.Code), ev.Value)
			}
		}
	}
}

func (c *Controller) handleUinput(code uint16, requestID int32) {
	switch code {
	case uiFFUpload:
		var up uinputFFUpload
		up.RequestID = uint32(requestID)
		if err := ioctl(c.file, uiBeginFFUpload, uintptr(unsafe.Pointer(&up))); err != nil {
			return
		}
		up.Retval = 0
		if up.Effect.Type != ffRumble {
			up.Retval = -22 // EINVAL: only rumble effects are registered
		} else {
			c.mu.Lock()
			_, wasPlaying := c.playing[up.Effect.ID]
			ffLog("upload id=%d mag=%d:%d len=%d delay=%d wasPlaying=%v", up.Effect.ID, up.Effect.Rumble.StrongMagnitude, up.Effect.Rumble.WeakMagnitude, up.Effect.Replay.Length, up.Effect.Replay.Delay, wasPlaying)
			c.effects[up.Effect.ID] = effectInfo{
				strong: up.Effect.Rumble.StrongMagnitude,
				weak:   up.Effect.Rumble.WeakMagnitude,
				length: up.Effect.Replay.Length,
				delay:  up.Effect.Replay.Delay,
			}
			var strong, weak uint16
			var changed bool
			if _, ok := c.playing[up.Effect.ID]; ok && c.rumble != nil {
				// Dynamic update of a playing effect: refresh magnitudes
				// and re-arm the synthesized stop against the new timing.
				strong, weak, changed = c.refreshLocked(up.Effect.ID, 1)
			}
			cb := c.rumble
			c.mu.Unlock()
			if changed && cb != nil {
				cb(strong, weak)
			}
		}
		_ = ioctl(c.file, uiEndFFUpload, uintptr(unsafe.Pointer(&up)))
	case uiFFErase:
		var er uinputFFErase
		er.RequestID = uint32(requestID)
		if err := ioctl(c.file, uiBeginFFErase, uintptr(unsafe.Pointer(&er))); err != nil {
			return
		}
		er.Retval = 0
		c.eraseEffect(int16(er.EffectID))
		_ = ioctl(c.file, uiEndFFErase, uintptr(unsafe.Pointer(&er)))
	}
}

func (c *Controller) fireEffect(id int16, value int32) {
	if value == 0 {
		c.stopEffect(id)
		return
	}
	c.startEffect(id, value)
}

// startEffect marks id playing, forwards the combined magnitudes of the
// playing set, and arms a synthesized stop when the effect carries finite
// timing. count is the kernel play count (EV_FF value): total hold is
// delay + length*count. Infinite effects (zero length, absurd count) hold
// until an explicit stop or erase.
func (c *Controller) startEffect(id int16, count int32) {
	c.mu.Lock()
	eff, ok := c.effects[id]
	if !ok || c.rumble == nil {
		ffLog("play id=%d count=%d ignored (known=%v)", id, count, ok)
		c.mu.Unlock()
		return
	}
	ms := effectDurationMs(eff, count)
	ffLog("play id=%d count=%d mag=%d:%d len=%d delay=%d autoStopMs=%d", id, count, eff.strong, eff.weak, eff.length, eff.delay, ms)
	strong, weak, changed := c.refreshLocked(id, count)
	cb := c.rumble
	c.mu.Unlock()
	if changed {
		cb(strong, weak)
	}
}

// stopEffect drops id from the playing set and forwards the remainder (or
// zero when nothing is left). Stops for unknown or already-stopped ids are
// no-ops beyond killing a stray timer.
func (c *Controller) stopEffect(id int16) {
	c.mu.Lock()
	_, wasPlaying := c.playing[id]
	ffLog("stop id=%d wasPlaying=%v", id, wasPlaying)
	if !wasPlaying {
		c.stopTimerLocked(id)
		c.mu.Unlock()
		return
	}
	strong, weak, changed := c.unplayLocked(id)
	cb := c.rumble
	c.mu.Unlock()
	if changed && cb != nil {
		cb(strong, weak)
	}
}

// eraseEffect forgets id. Removing an effect stops it if it was playing
// (per the FF docs), and the kernel sends no stop event for that, so the
// remainder is forwarded here instead of leaving the phone buzzing.
func (c *Controller) eraseEffect(id int16) {
	c.mu.Lock()
	_, wasPlaying := c.playing[id]
	ffLog("erase id=%d wasPlaying=%v", id, wasPlaying)
	delete(c.effects, id)
	var strong, weak uint16
	changed := false
	if _, ok := c.playing[id]; ok {
		strong, weak, changed = c.unplayLocked(id)
	} else {
		c.stopTimerLocked(id)
	}
	cb := c.rumble
	c.mu.Unlock()
	if changed && cb != nil {
		cb(strong, weak)
	}
}

// refreshLocked (re)starts id in the playing set with the given play count
// and re-arms its synthesized stop. Caller must hold c.mu.
func (c *Controller) refreshLocked(id int16, count int32) (uint16, uint16, bool) {
	c.stopTimerLocked(id)
	c.gen++
	c.playing[id] = c.gen
	gen := c.gen
	if ms := effectDurationMs(c.effects[id], count); ms > 0 {
		c.timers[id] = time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
			c.onEffectTimeout(id, gen)
		})
	}
	strong, weak, changed := c.combinedLocked()
	if changed {
		c.lastStrong, c.lastWeak = strong, weak
	}
	return strong, weak, changed
}

// unplayLocked drops id from the playing set. Caller must hold c.mu.
func (c *Controller) unplayLocked(id int16) (uint16, uint16, bool) {
	delete(c.playing, id)
	c.stopTimerLocked(id)
	strong, weak, changed := c.combinedLocked()
	if changed {
		c.lastStrong, c.lastWeak = strong, weak
	}
	return strong, weak, changed
}

// combinedLocked returns the max magnitudes across the playing set, so
// overlapping effects (left/right motors as separate uploads) hold until
// the last one ends instead of first-stop-wins. Caller must hold c.mu.
func (c *Controller) combinedLocked() (strong, weak uint16, changed bool) {
	for id := range c.playing {
		if eff, ok := c.effects[id]; ok {
			if eff.strong > strong {
				strong = eff.strong
			}
			if eff.weak > weak {
				weak = eff.weak
			}
		}
	}
	return strong, weak, strong != c.lastStrong || weak != c.lastWeak
}

func (c *Controller) stopTimerLocked(id int16) {
	if t, ok := c.timers[id]; ok {
		t.Stop()
		delete(c.timers, id)
	}
}

// onEffectTimeout ends a finite play whose stop the kernel handled
// internally. The generation check drops stale timers after a re-play.
func (c *Controller) onEffectTimeout(id int16, gen uint64) {
	c.mu.Lock()
	ffLog("timeout id=%d gen=%d current=%d destroyed=%v", id, gen, c.playing[id], c.destroyed)
	if c.destroyed || c.playing[id] != gen {
		c.mu.Unlock()
		return
	}
	strong, weak, changed := c.unplayLocked(id)
	cb := c.rumble
	c.mu.Unlock()
	if changed && cb != nil {
		cb(strong, weak)
	}
}

// effectDurationMs converts an effect's finite timing into a hold duration
// in milliseconds. Zero length, non-positive or absurd play counts, and
// overlong totals return 0: hold until an explicit stop or erase.
func effectDurationMs(eff effectInfo, count int32) uint64 {
	if eff.length == 0 || count < 1 || count > 1024 {
		return 0
	}
	total := uint64(eff.delay) + uint64(eff.length)*uint64(count)
	if total == 0 || total > maxTimedEffectMs {
		return 0
	}
	return total
}

// Destroy removes the virtual device and releases the file descriptor. It is
// safe to call more than once, and it always returns: the read-loop wait is
// bounded so a kernel wedge cannot deadlock session teardown (and SIGINT)
// behind it.
func (c *Controller) Destroy() error {
	var err error
	c.destroy.Do(func() {
		c.mu.Lock()
		c.destroyed = true
		for id, t := range c.timers {
			t.Stop()
			delete(c.timers, id)
		}
		clear(c.playing)
		c.mu.Unlock()

		// Keep device writes serialized with uiDevDestroy. Apply checks
		// destroyed before writing, so this also lets an in-flight write finish
		// without racing the kernel device teardown.
		c.writeMu.Lock()
		err = ioctl(c.file, uiDevDestroy, 0)
		c.writeMu.Unlock()

		// Closing unblocks a readLoop parked in the net poller: its Read
		// fails and the loop exits via loopDone. The loop never calls
		// File.Fd, so Close cannot race it under the race detector.
		cerr := c.file.Close()
		if err == nil {
			err = cerr
		}
		select {
		case <-c.loopDone:
		case <-time.After(destroyWaitTimeout):
			if err == nil {
				err = errors.New("uinput: read loop did not exit after destroy")
			}
		}
	})
	return err
}
