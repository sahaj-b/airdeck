package session

import "time"

type PlayerState string

const (
	StateActive            PlayerState = "active"
	StateStale             PlayerState = "stale"
	StateDisconnectedGrace PlayerState = "disconnected-grace"
	StateDeviceError       PlayerState = "device-error"
)

type Player struct {
	ID            string
	Slot          int
	Name          string
	Accent        string
	State         PlayerState
	LayoutID      string
	Generation    uint64
	ReconnectID   string
	LastInput     time.Time
	lastFrame     time.Time
	LastPong      time.Time
	RTT           time.Duration
	DeviceReason  string
	Send          func(any) error
	Close         func()
	LastSequence  uint32
	HasSequence   bool
	GraceDeadline time.Time
}

type PlayerSnapshot struct {
	ID            string      `json:"id"`
	Slot          int         `json:"slot"`
	Name          string      `json:"name"`
	Accent        string      `json:"accent"`
	State         PlayerState `json:"state"`
	LayoutID      string      `json:"layoutId"`
	Generation    uint64      `json:"generation"`
	ReconnectID   string      `json:"-"`
	LastInput     time.Time   `json:"lastInput"`
	LastPong      time.Time   `json:"lastPong"`
	RTT           int64       `json:"rttNanos"`
	DeviceReason  string      `json:"deviceReason,omitempty"`
	GraceDeadline time.Time   `json:"graceDeadline,omitempty"`
	// Relayed is host-observed transport set by httpserver at snapshot time.
	Relayed bool `json:"relayed"`
	// RelayState is the dashboard badge: direct, relayed, or unknown
	// (connecting, gone, or LAN socket). Unknown renders as pending, not
	// direct, so the badge never lies during ICE setup.
	RelayState string `json:"relayState"`
}

func (p *Player) Snapshot() PlayerSnapshot {
	return PlayerSnapshot{
		ID: p.ID, Slot: p.Slot, Name: p.Name, Accent: p.Accent,
		State: p.State, LayoutID: p.LayoutID, Generation: p.Generation, ReconnectID: p.ReconnectID,
		LastInput: p.LastInput,
		LastPong:  p.LastPong, RTT: p.RTT.Nanoseconds(),
		DeviceReason: p.DeviceReason, GraceDeadline: p.GraceDeadline,
	}
}
