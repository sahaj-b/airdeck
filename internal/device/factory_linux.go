//go:build linux

package device

import "github.com/sahaj-b/airdeck/internal/uinput"

type UInputFactory struct{}

func (UInputFactory) Create(rumble RumbleFunc) (Device, error) {
	return uinput.NewController(uinput.Config{Rumble: rumble})
}

func DefaultFactory() Factory { return UInputFactory{} }
