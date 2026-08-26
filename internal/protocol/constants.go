package protocol

const (
	Version    uint8 = 1
	FrameSize        = 20
	FrameFlags       = 0
)

const (
	BitSouth uint32 = 1 << iota
	BitEast
	BitWest
	BitNorth
	BitDPadUp
	BitDPadDown
	BitDPadLeft
	BitDPadRight
	BitLB
	BitRB
	BitLS
	BitRS
	BitStart
	BitBack
	BitGuide
)

const KnownButtonBits uint32 = (1 << 15) - 1

type Command string

const (
	CommandSouth         Command = "south"
	CommandEast          Command = "east"
	CommandWest          Command = "west"
	CommandNorth         Command = "north"
	CommandDPadUp        Command = "dpadUp"
	CommandDPadDown      Command = "dpadDown"
	CommandDPadLeft      Command = "dpadLeft"
	CommandDPadRight     Command = "dpadRight"
	CommandLeftShoulder  Command = "leftShoulder"
	CommandRightShoulder Command = "rightShoulder"
	CommandLeftStick     Command = "leftStick"
	CommandRightStick    Command = "rightStick"
	CommandStart         Command = "start"
	CommandBack          Command = "back"
	CommandGuide         Command = "guide"
	CommandLeftTrigger   Command = "leftTrigger"
	CommandRightTrigger  Command = "rightTrigger"
)

var KnownCommands = map[Command]struct{}{
	CommandSouth: {}, CommandEast: {}, CommandWest: {}, CommandNorth: {},
	CommandDPadUp: {}, CommandDPadDown: {}, CommandDPadLeft: {}, CommandDPadRight: {},
	CommandLeftShoulder: {}, CommandRightShoulder: {}, CommandLeftStick: {}, CommandRightStick: {},
	CommandStart: {}, CommandBack: {}, CommandGuide: {}, CommandLeftTrigger: {}, CommandRightTrigger: {},
}
