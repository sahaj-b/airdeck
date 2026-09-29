//go:build windows

package doctor

import "github.com/sahaj-b/airdeck/internal/vigem"

// realProbe runs the production ViGEm checks over one shared connection.
type realProbe struct{}

func (realProbe) check() (busErr, capErr error) {
	c, err := vigem.Connect(nil)
	if err != nil {
		return err, err
	}
	defer c.Close()
	pad, err := vigem.NewPad(c, nil)
	if err != nil {
		return nil, err
	}
	if err := pad.Neutralize(); err != nil {
		_ = pad.Destroy()
		return nil, err
	}
	return nil, pad.Destroy()
}
