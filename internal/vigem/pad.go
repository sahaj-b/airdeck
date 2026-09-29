//go:build windows

package vigem

import (
	"fmt"
	"sync"

	"golang.org/x/sys/windows"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

// RumbleFunc mirrors device.RumbleFunc without importing device (device
// imports vigem, so the edge must point one way).
type RumbleFunc func(strong, weak uint16)

// Pad is one Xbox 360 pad on the shared client. Apply holds the mutex
// across the DLL update so an update can never run on a freed target;
// Destroy flips the flag under the mutex, then unplugs without holding it.
type Pad struct {
	client   *Client
	target   uintptr
	rumble   RumbleFunc
	callback uintptr

	mu         sync.Mutex
	last       Report
	started    bool
	destroyed  bool
	destroy    sync.Once
	destroyErr error
}

// NewPad allocates an x360 target, plugs it in (vigem_target_add blocks
// until the target is fully operational), and registers the rumble
// notification when rumble handling is configured. The callback pointer is
// stored so Destroy can unregister it.
func NewPad(client *Client, rumble RumbleFunc) (*Pad, error) {
	target := client.api.x360Alloc()
	if target == 0 {
		return nil, fmt.Errorf("vigem: x360 alloc returned null target")
	}
	if code := client.api.add(client.client, target); !Succeeded(code) {
		client.api.freeTarget(target)
		return nil, Error(code)
	}
	p := &Pad{client: client, target: target, rumble: rumble}
	if rumble == nil {
		return p, nil
	}
	cb := windows.NewCallback(p.notification)
	if code := client.api.registerNotify(client.client, target, cb, 0); !Succeeded(code) {
		client.api.remove(client.client, target)
		client.api.freeTarget(target)
		return nil, Error(code)
	}
	p.callback = cb
	return p, nil
}

// notification is the EVT_VIGEM_X360_NOTIFICATION trampoline (stdcall via
// windows.NewCallback). It fires on a ViGEm thread: minimal work, never
// block.
func (p *Pad) notification(client, target uintptr, large, small, led uint8, userData uintptr) uintptr {
	p.mu.Lock()
	rumble, destroyed := p.rumble, p.destroyed
	p.mu.Unlock()
	if destroyed || rumble == nil {
		return 0
	}
	rumble(uint16(large)*257, uint16(small)*257)
	return 0
}

// Apply maps the snapshot and submits it to the DLL. An identical report
// skips the DLL call, so steady-state frames stay free. After Destroy it
// is a no-op returning nil.
func (p *Pad) Apply(s uinput.State) error {
	report := MapState(s)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.destroyed {
		return nil
	}
	if p.started && p.last == report {
		return nil
	}
	if code := p.client.api.update(p.client.client, p.target, &report); !Succeeded(code) {
		return Error(code)
	}
	p.last = report
	p.started = true
	return nil
}

// Neutralize releases every control. Cheap when the state is already neutral.
func (p *Pad) Neutralize() error {
	return p.Apply(uinput.Neutral)
}

// Destroy unregisters the notification, unplugs, and frees the target.
// Idempotent; safe to call more than once.
func (p *Pad) Destroy() error {
	p.destroy.Do(func() {
		p.mu.Lock()
		p.destroyed = true
		p.mu.Unlock()
		if p.callback != 0 {
			p.client.api.unregisterNotify(p.target)
		}
		if code := p.client.api.remove(p.client.client, p.target); !Succeeded(code) {
			p.destroyErr = Error(code)
		}
		p.client.api.freeTarget(p.target)
	})
	return p.destroyErr
}

// Syspath returns a stable pad identifier for diagnostics.
func (p *Pad) Syspath() (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.destroyed {
		return "", fmt.Errorf("vigem: pad is destroyed")
	}
	index := p.client.api.getIndex(p.target)
	return fmt.Sprintf("vigem:x360:%d", index), nil
}
