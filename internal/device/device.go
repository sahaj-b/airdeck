package device

import (
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type RumbleFunc func(strong, weak uint16)

type Device interface {
	Apply(uinput.State) error
	Neutralize() error
	Destroy() error
	Syspath() (string, error)
}

type Factory interface {
	Create(RumbleFunc) (Device, error)
}
