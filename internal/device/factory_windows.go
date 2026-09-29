//go:build windows

package device

import (
	"errors"
	"fmt"
	"sync"

	"github.com/sahaj-b/airdeck/internal/vigem"
)

// ViGEmFactory creates Xbox 360 pads on a lazily initialized shared client.
type ViGEmFactory struct {
	mu     sync.Mutex
	client *vigem.Client
	closed bool
}

func (f *ViGEmFactory) Create(rumble RumbleFunc) (Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return nil, errors.New("vigem factory is closed")
	}
	if f.client == nil {
		client, err := vigem.Connect(nil)
		if err != nil {
			return nil, fmt.Errorf("vigem connect: %w", err)
		}
		f.client = client
	}
	return vigem.NewPad(f.client, vigem.RumbleFunc(rumble))
}

func (f *ViGEmFactory) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	if f.client == nil {
		return nil
	}
	err := f.client.Close()
	f.client = nil
	return err
}

func DefaultFactory() Factory { return &ViGEmFactory{} }
