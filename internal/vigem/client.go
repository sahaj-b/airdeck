//go:build windows

package vigem

import (
	"errors"
	"sync"
)

// Client is one shared ViGEmBus connection. Updates go straight to the DLL;
// each Pad serializes its own target, and distinct targets share no mutable
// state, so pads never contend on a queue.
type Client struct {
	api    *dllAPI
	client uintptr

	mu     sync.Mutex
	closed bool
}

// Connect opens the shared ViGEm client. api nil loads the real DLL.
// A BUS_NOT_FOUND code is the doctor and serve-gate probe signal.
func Connect(api *dllAPI) (*Client, error) {
	var err error
	if api == nil {
		if api, err = loadDLL(""); err != nil {
			return nil, err
		}
	}
	client := api.alloc()
	if client == 0 {
		return nil, errors.New("vigem: alloc returned null client")
	}
	if code := api.connect(client); !Succeeded(code) {
		api.free(client)
		return nil, Error(code)
	}
	return &Client{api: api, client: client}, nil
}

// CheckDLL verifies that the client exposes every procedure airdeck uses.
func CheckDLL() error {
	_, err := loadDLL("")
	return err
}

// Probe checks for the bus without keeping a connection open. It is the
// doctor check and the serve gate.
func Probe(api *dllAPI) error {
	c, err := Connect(api)
	if err != nil {
		return err
	}
	return c.Close()
}

// Close disconnects and frees the client. Still-attached targets die with
// the disconnect, and un-removed targets die with the process, so there is
// no orphan-device class on Windows. Idempotent.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	c.closed = true
	c.api.disconnect(c.client)
	c.api.free(c.client)
	return nil
}
