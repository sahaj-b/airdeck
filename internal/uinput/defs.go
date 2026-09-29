//go:build linux

// Package uinput creates Xbox 360-style virtual gamepads through the Linux
// uinput kernel interface. It is shaped around airdeck's 20-byte input
// snapshot frame: a canonical digital button bitset, four signed i16 stick
// axes, and two u8 analog triggers. Only changed events are written per
// snapshot, followed by a single SYN report.
//
// Devices open O_RDWR and register FF_RUMBLE so the kernel forwards game
// rumble requests back to the host process.
package uinput

import (
	"os"
	"syscall"
	"unsafe"
)

// ioctl commands from linux/uinput.h.
const (
	uiSetEvBit  = 0x40045564 // _IOW('U', 100, int)
	uiSetKeyBit = 0x40045565 // _IOW('U', 101, int)
	uiSetRelBit = 0x40045566 // _IOW('U', 102, int)
	uiSetAbsBit = 0x40045567 // _IOW('U', 103, int)
	uiSetFFBit  = 0x4004556b // _IOW('U', 107, int)

	uiDevCreate  = 0x5501
	uiDevDestroy = 0x5502

	// Force-feedback handshake. Sizes match struct uinput_ff_upload (104)
	// and struct uinput_ff_erase (12) on 64-bit.
	uiBeginFFUpload = 0xc06855c8 // _IOWR('U', 200, struct uinput_ff_upload)
	uiEndFFUpload   = 0x406855c9 // _IOW('U', 201, struct uinput_ff_upload)
	uiBeginFFErase  = 0xc00c55ca // _IOWR('U', 202, struct uinput_ff_erase)
	uiEndFFErase    = 0x400c55cb // _IOW('U', 203, struct uinput_ff_erase)

	// _IOC(_IOC_READ, 'U', 44, 64): kernel-written input<N> sysfs name.
	uiGetSysname = 0x8041552c
)

// Event types and codes from linux/input-event-codes.h.
const (
	evSyn    = 0x00
	evKey    = 0x01
	evAbs    = 0x03
	evFF     = 0x15
	evUinput = 0x0101

	synReport = 0

	absX     = 0x00
	absY     = 0x01
	absZ     = 0x02
	absRX    = 0x03
	absRY    = 0x04
	absRZ    = 0x05
	absHat0X = 0x10
	absHat0Y = 0x11

	btnSouth  = 0x130 // A
	btnEast   = 0x131 // B
	btnNorth  = 0x133 // Y
	btnWest   = 0x134 // X
	btnTL     = 0x136 // LB
	btnTR     = 0x137 // RB
	btnSelect = 0x13a // Back
	btnStart  = 0x13b
	btnMode   = 0x13c // Guide
	btnThumbl = 0x13d // LS click
	btnThumbr = 0x13e // RS click

	ffRumble = 0x50

	// EV_UINPUT request codes sent to the device creator.
	uiFFUpload = 1
	uiFFErase  = 2

	busUsb = 0x03
)

const (
	uinputMaxNameSize = 80
	absCnt            = 64
	inputEventSize    = 24
)

// Microsoft Xbox 360 wired controller identity so Steam Input and games see
// a known-good generic pad.
var xbox360ID = inputID{
	Bustype: busUsb,
	Vendor:  0x045e,
	Product: 0x028e,
	Version: 0x114,
}

type inputID struct {
	Bustype uint16
	Vendor  uint16
	Product uint16
	Version uint16
}

// uinputUserDev mirrors struct uinput_user_dev. Field order and padding must
// match the kernel header exactly; ff_effects_max sits between id and absmax.
type uinputUserDev struct {
	Name      [uinputMaxNameSize]byte
	ID        inputID
	FfEffects uint32
	Absmax    [absCnt]int32
	Absmin    [absCnt]int32
	Absfuzz   [absCnt]int32
	Absflat   [absCnt]int32
}

type inputEvent struct {
	Time  syscall.Timeval
	Type  uint16
	Code  uint16
	Value int32
}

type ffTrigger struct {
	Button   uint16
	Interval uint16
}

type ffReplay struct {
	Length uint16
	Delay  uint16
}

type ffRumbleEffect struct {
	StrongMagnitude uint16
	WeakMagnitude   uint16
}

// ffEffect mirrors struct ff_effect. The C union is 32 bytes (largest member
// is ff_periodic_effect, whose custom_data pointer forces 8-byte alignment),
// so the struct totals 48 bytes regardless of the effect type in use.
type ffEffect struct {
	Type      uint16
	ID        int16
	Direction uint16
	Trigger   ffTrigger
	Replay    ffReplay
	_         [2]byte // align union to offset 16
	Rumble    ffRumbleEffect
	_         [28]byte // union remainder
}

type uinputFFUpload struct {
	RequestID uint32
	Retval    int32
	Effect    ffEffect
	Old       ffEffect
}

type uinputFFErase struct {
	RequestID uint32
	Retval    int32
	EffectID  uint32
}

func ioctl(f *os.File, cmd, arg uintptr) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), cmd, arg); errno != 0 {
		return errno
	}
	return nil
}

func init() {
	// The kernel validates FF ioctl sizes against these structs; drift fails
	// silently as an unanswered upload handshake, so pin the ABI.
	if unsafe.Sizeof(ffEffect{}) != 48 ||
		unsafe.Sizeof(uinputFFUpload{}) != 104 ||
		unsafe.Sizeof(uinputFFErase{}) != 12 {
		panic("uinput: force-feedback struct layout does not match kernel ABI")
	}
}
