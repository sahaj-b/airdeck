package uinput

// Canonical digital bitset, matching the v1 wire frame's W3C-style bits:
// face 0-3, D-pad 4-7, shoulders 8-9, stick clicks 10-11, Start/Back 12-13,
// Guide 14.
const (
	BtnSouth = 1 << iota
	BtnEast
	BtnWest
	BtnNorth
	BtnDPadUp
	BtnDPadDown
	BtnDPadLeft
	BtnDPadRight
	BtnLB
	BtnRB
	BtnLS
	BtnRS
	BtnStart
	BtnBack
	BtnGuide
)

// State is one complete controller snapshot. Sticks are signed i16 with X
// positive right and Y positive down; triggers are u8 from 0 to 255. This is
// the same shape as the airdeck wire frame payload.
type State struct {
	Buttons uint32
	LX, LY  int16
	RX, RY  int16
	LT, RT  uint8
}

// Neutral is the all-released state used by the watchdog and cleanup paths.
var Neutral = State{}
