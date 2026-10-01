package vigem

import "fmt"

// ViGEm error codes from ViGEmClient ViGEm/Client.h.
const (
	VigemErrorNone                      uint32 = 0x20000000
	VigemErrorBusNotFound               uint32 = 0xE0000001
	VigemErrorNoFreeSlot                uint32 = 0xE0000002
	VigemErrorInvalidTarget             uint32 = 0xE0000003
	VigemErrorRemovalFailed             uint32 = 0xE0000004
	VigemErrorAlreadyConnected          uint32 = 0xE0000005
	VigemErrorTargetUninitialized       uint32 = 0xE0000006
	VigemErrorTargetNotPluggedIn        uint32 = 0xE0000007
	VigemErrorBusVersionMismatch        uint32 = 0xE0000008
	VigemErrorBusAccessFailed           uint32 = 0xE0000009
	VigemErrorCallbackAlreadyRegistered uint32 = 0xE0000010
	VigemErrorCallbackNotFound          uint32 = 0xE0000011
	VigemErrorBusAlreadyConnected       uint32 = 0xE0000012
	VigemErrorBusInvalidHandle          uint32 = 0xE0000013
	VigemErrorXUSBUserIndexOutOfRange   uint32 = 0xE0000014
	VigemErrorInvalidParameter          uint32 = 0xE0000015
	VigemErrorNotSupported              uint32 = 0xE0000016
	VigemErrorWinAPI                    uint32 = 0xE0000017
	VigemErrorTimedOut                  uint32 = 0xE0000018
	VigemErrorIsDisposing               uint32 = 0xE0000019
)

// Error is a ViGEmBus return code.
type Error uint32

func (e Error) Error() string {
	switch uint32(e) {
	case VigemErrorNone:
		return "vigem: success"
	case VigemErrorBusNotFound:
		return "vigem: bus not found (install the ViGEmBus driver via airdeck setup)"
	case VigemErrorNoFreeSlot:
		return "vigem: no free slot"
	case VigemErrorInvalidTarget:
		return "vigem: invalid target"
	case VigemErrorRemovalFailed:
		return "vigem: removal failed"
	case VigemErrorAlreadyConnected:
		return "vigem: already connected"
	case VigemErrorTargetUninitialized:
		return "vigem: target uninitialized"
	case VigemErrorTargetNotPluggedIn:
		return "vigem: target not plugged in"
	case VigemErrorBusVersionMismatch:
		return "vigem: bus version mismatch"
	case VigemErrorBusAccessFailed:
		return "vigem: bus access failed"
	case VigemErrorCallbackAlreadyRegistered:
		return "vigem: callback already registered"
	case VigemErrorCallbackNotFound:
		return "vigem: callback not found"
	case VigemErrorBusAlreadyConnected:
		return "vigem: bus already connected"
	case VigemErrorBusInvalidHandle:
		return "vigem: bus invalid handle"
	case VigemErrorXUSBUserIndexOutOfRange:
		return "vigem: xusb user index out of range"
	case VigemErrorInvalidParameter:
		return "vigem: invalid parameter"
	case VigemErrorNotSupported:
		return "vigem: not supported"
	case VigemErrorWinAPI:
		return "vigem: winapi error"
	case VigemErrorTimedOut:
		return "vigem: timed out"
	case VigemErrorIsDisposing:
		return "vigem: disposing"
	default:
		return fmt.Sprintf("vigem: error %#x", uint32(e))
	}
}

// Succeeded reports whether a ViGEm return code means success.
func Succeeded(code uint32) bool { return code == VigemErrorNone }
