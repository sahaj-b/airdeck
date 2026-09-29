//go:build linux

package uinput

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

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
	Rumble func(strong, weak uint16)
}

type Controller struct {
	file    *os.File
	rumble  func(strong, weak uint16)
	effects map[int16]ffRumbleEffect

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
		effects:  make(map[int16]ffRumbleEffect),
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
			c.effects[up.Effect.ID] = up.Effect.Rumble
			c.mu.Unlock()
		}
		_ = ioctl(c.file, uiEndFFUpload, uintptr(unsafe.Pointer(&up)))
	case uiFFErase:
		var er uinputFFErase
		er.RequestID = uint32(requestID)
		if err := ioctl(c.file, uiBeginFFErase, uintptr(unsafe.Pointer(&er))); err != nil {
			return
		}
		er.Retval = 0
		c.mu.Lock()
		delete(c.effects, int16(er.EffectID))
		c.mu.Unlock()
		_ = ioctl(c.file, uiEndFFErase, uintptr(unsafe.Pointer(&er)))
	}
}

func (c *Controller) fireEffect(id int16, value int32) {
	c.mu.Lock()
	effect, ok := c.effects[id]
	c.mu.Unlock()
	if !ok || c.rumble == nil {
		return
	}
	if value == 0 {
		c.rumble(0, 0)
		return
	}
	c.rumble(effect.StrongMagnitude, effect.WeakMagnitude)
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
