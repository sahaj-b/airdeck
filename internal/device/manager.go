package device

import (
	"errors"
	"fmt"
	"sync"

	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

const MaxSlots = protocol.MaxPlayers

var ErrSlotOccupied = errors.New("slot already has a device")

type Manager struct {
	mu          sync.RWMutex
	lifecycleMu sync.Mutex
	factory     Factory
	devices     map[int]Device
}

func NewManager(factory Factory) *Manager {
	return &Manager{factory: factory, devices: make(map[int]Device)}
}

func (m *Manager) Create(slot int, rumble RumbleFunc) error {
	if slot < 0 || slot >= MaxSlots {
		return fmt.Errorf("slot %d is outside 0..%d", slot, MaxSlots-1)
	}
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.RLock()
	_, exists := m.devices[slot]
	m.mu.RUnlock()
	if exists {
		return ErrSlotOccupied
	}
	device, err := m.factory.Create(rumble)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.devices[slot] = device
	m.mu.Unlock()
	return nil
}

func (m *Manager) Apply(slot int, state uinput.State) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.RLock()
	device := m.devices[slot]
	m.mu.RUnlock()
	if device == nil {
		return fmt.Errorf("slot %d has no device", slot)
	}
	return device.Apply(state)
}

func (m *Manager) Neutralize(slot int) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.RLock()
	device := m.devices[slot]
	m.mu.RUnlock()
	if device == nil {
		return nil
	}
	return device.Neutralize()
}

func (m *Manager) Destroy(slot int) error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	device := m.devices[slot]
	delete(m.devices, slot)
	m.mu.Unlock()
	if device == nil {
		return nil
	}
	neutralizeErr := device.Neutralize()
	destroyErr := device.Destroy()
	return errors.Join(neutralizeErr, destroyErr)
}

func (m *Manager) DestroyAll() error {
	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()
	m.mu.Lock()
	devices := make(map[int]Device, len(m.devices))
	for slot, device := range m.devices {
		devices[slot] = device
	}
	m.devices = make(map[int]Device)
	m.mu.Unlock()
	var errs []error
	for _, device := range devices {
		if err := device.Neutralize(); err != nil {
			errs = append(errs, err)
		}
		if err := device.Destroy(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
