package device

import (
	"errors"
	"fmt"
	"sync"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

const MaxSlots = 16

var ErrSlotOccupied = errors.New("slot already has a device")

type Manager struct {
	mu      sync.RWMutex
	factory Factory
	devices map[int]Device
}

func NewManager(factory Factory) *Manager {
	return &Manager{factory: factory, devices: make(map[int]Device)}
}

func (m *Manager) Create(slot int, rumble RumbleFunc) error {
	if slot < 0 || slot >= MaxSlots {
		return fmt.Errorf("slot %d is outside 0..%d", slot, MaxSlots-1)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.devices[slot]; exists {
		return ErrSlotOccupied
	}
	device, err := m.factory.Create(rumble)
	if err != nil {
		return err
	}
	m.devices[slot] = device
	return nil
}

func (m *Manager) Apply(slot int, state uinput.State) error {
	m.mu.RLock()
	device := m.devices[slot]
	m.mu.RUnlock()
	if device == nil {
		return fmt.Errorf("slot %d has no device", slot)
	}
	return device.Apply(state)
}

func (m *Manager) Neutralize(slot int) error {
	m.mu.RLock()
	device := m.devices[slot]
	m.mu.RUnlock()
	if device == nil {
		return nil
	}
	return device.Neutralize()
}

func (m *Manager) Destroy(slot int) error {
	m.mu.Lock()
	device := m.devices[slot]
	delete(m.devices, slot)
	m.mu.Unlock()
	if device == nil {
		return nil
	}
	if err := device.Neutralize(); err != nil {
		_ = device.Destroy()
		return err
	}
	return device.Destroy()
}

func (m *Manager) DestroyAll() error {
	m.mu.Lock()
	devices := make(map[int]Device, len(m.devices))
	for slot, device := range m.devices {
		devices[slot] = device
	}
	m.devices = make(map[int]Device)
	m.mu.Unlock()
	var first error
	for _, device := range devices {
		if err := device.Neutralize(); err != nil && first == nil {
			first = err
		}
		if err := device.Destroy(); err != nil && first == nil {
			first = err
		}
	}
	return first
}
