package vigem

import (
	"testing"
	"unsafe"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

func TestReportLayout(t *testing.T) {
	if size := unsafe.Sizeof(Report{}); size != 12 {
		t.Fatalf("Report size = %d, want 12", size)
	}
}

func TestMapStateButtons(t *testing.T) {
	cases := []struct {
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
	for _, c := range cases {
		if report := MapState(uinput.State{Buttons: c.canonical}); report.Buttons != c.xusb {
			t.Errorf("canonical bit %#x -> %#x, want %#x", c.canonical, report.Buttons, c.xusb)
		}
	}
}

func TestMapStateAllButtons(t *testing.T) {
	all := uint32(uinput.BtnSouth | uinput.BtnEast | uinput.BtnWest | uinput.BtnNorth |
		uinput.BtnDPadUp | uinput.BtnDPadDown | uinput.BtnDPadLeft | uinput.BtnDPadRight |
		uinput.BtnLB | uinput.BtnRB | uinput.BtnLS | uinput.BtnRS |
		uinput.BtnStart | uinput.BtnBack | uinput.BtnGuide)
	report := MapState(uinput.State{Buttons: all})
	want := uint16(XUSBA | XUSBB | XUSBX | XUSBY |
		XUSBDPadUp | XUSBDPadDown | XUSBDPadLeft | XUSBDPadRight |
		XUSBLeftShoulder | XUSBRightShoulder | XUSBLeftThumb | XUSBRightThumb |
		XUSBStart | XUSBBack | XUSBGuide)
	if report.Buttons != want {
		t.Fatalf("all buttons -> %#x, want %#x", report.Buttons, want)
	}
}

func TestMapStateNeutral(t *testing.T) {
	if report := MapState(uinput.Neutral); report != (Report{}) {
		t.Fatalf("neutral -> %+v, want zeroed report", report)
	}
}

func TestMapStateSticksAndTriggers(t *testing.T) {
	report := MapState(uinput.State{LX: 1000, LY: 2000, RX: -3000, RY: -4000, LT: 255, RT: 128})
	if report.LX != 1000 {
		t.Errorf("LX = %d, want 1000", report.LX)
	}
	if report.LY != -2000 {
		t.Errorf("LY = %d, want -2000 (negated)", report.LY)
	}
	if report.RX != -3000 {
		t.Errorf("RX = %d, want -3000", report.RX)
	}
	if report.RY != 4000 {
		t.Errorf("RY = %d, want 4000 (negated)", report.RY)
	}
	if report.LT != 255 || report.RT != 128 {
		t.Errorf("triggers = (%d,%d), want (255,128)", report.LT, report.RT)
	}
}

func TestMapStateYNegationEdge(t *testing.T) {
	// -(-32768) wraps to -32768 in Go int16 arithmetic; magnitude preserved.
	report := MapState(uinput.State{LY: -32768, RY: -32768})
	if report.LY != -32768 || report.RY != -32768 {
		t.Fatalf("Y -32768 -> (%d,%d), want (-32768,-32768)", report.LY, report.RY)
	}
	report = MapState(uinput.State{LY: 32767, RY: 32767})
	if report.LY != -32767 || report.RY != -32767 {
		t.Fatalf("Y 32767 -> (%d,%d), want (-32767,-32767)", report.LY, report.RY)
	}
}
