package vigem

import "github.com/sahaj-b/airdeck/internal/uinput"

// XUSB button bits from ViGEmClient ViGEm/Common.h XUSB_BUTTON enum.
const (
	XUSBDPadUp        uint16 = 0x0001
	XUSBDPadDown      uint16 = 0x0002
	XUSBDPadLeft      uint16 = 0x0004
	XUSBDPadRight     uint16 = 0x0008
	XUSBStart         uint16 = 0x0010
	XUSBBack          uint16 = 0x0020
	XUSBLeftThumb     uint16 = 0x0040
	XUSBRightThumb    uint16 = 0x0080
	XUSBLeftShoulder  uint16 = 0x0100
	XUSBRightShoulder uint16 = 0x0200
	XUSBGuide         uint16 = 0x0400
	XUSBA             uint16 = 0x1000
	XUSBB             uint16 = 0x2000
	XUSBX             uint16 = 0x4000
	XUSBY             uint16 = 0x8000
)

// Report mirrors XUSB_REPORT: 12 bytes, little-endian, with two trigger
// bytes followed by four signed stick shorts.
type Report struct {
	Buttons uint16
	LT, RT  byte
	LX, LY  int16
	RX, RY  int16
}

// buttonMap pairs each canonical airdeck bit with its XUSB button bit.
var buttonMap = []struct {
	canonical uint32
	xusb      uint16
}{
	{uinput.BtnSouth, XUSBA},
	{uinput.BtnEast, XUSBB},
	{uinput.BtnWest, XUSBX},
	{uinput.BtnNorth, XUSBY},
	{uinput.BtnDPadUp, XUSBDPadUp},
	{uinput.BtnDPadDown, XUSBDPadDown},
	{uinput.BtnDPadLeft, XUSBDPadLeft},
	{uinput.BtnDPadRight, XUSBDPadRight},
	{uinput.BtnLB, XUSBLeftShoulder},
	{uinput.BtnRB, XUSBRightShoulder},
	{uinput.BtnLS, XUSBLeftThumb},
	{uinput.BtnRS, XUSBRightThumb},
	{uinput.BtnStart, XUSBStart},
	{uinput.BtnBack, XUSBBack},
	{uinput.BtnGuide, XUSBGuide},
}

// MapState converts a canonical airdeck snapshot into an XUSB report.
// XUSB stick Y is positive-up while airdeck wire Y is positive-down, so Y
// axes are negated. -(-32768) wraps to -32768 and preserves the magnitude.
func MapState(s uinput.State) Report {
	var buttons uint16
	for _, b := range buttonMap {
		if s.Buttons&b.canonical != 0 {
			buttons |= b.xusb
		}
	}
	return Report{
		Buttons: buttons,
		LT:      s.LT,
		RT:      s.RT,
		LX:      s.LX,
		LY:      -s.LY,
		RX:      s.RX,
		RY:      -s.RY,
	}
}
