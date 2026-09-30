package transport

import (
	"encoding/json"
	"errors"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/protocol"
)

type outbound struct {
	messageType int
	payload     []byte
	closeAfter  bool
}

const maxPendingPings = 8

// rumbleRefreshInterval coalesces identical rumble repeats inside this
// window. Games often re-set an unchanged vibration state every frame; the
// phone already holds it, so resending only pressures the queue. Repeats
// after the window still pass through, which re-arms the phone's clamped
// vibration pattern and keeps legit long rumbles alive.
const rumbleRefreshInterval = 1500 * time.Millisecond

type Client struct {
	conn         *websocket.Conn
	out          chan outbound
	done         chan struct{}
	closeOnce    sync.Once
	writerOnce   sync.Once
	closing      atomic.Bool
	pingMu       sync.Mutex
	pending      map[string]time.Time
	rumbleMu     sync.Mutex
	lastRumble   protocol.Rumble
	hasRumble    bool
	lastRumbleAt time.Time
}

func newClient(conn *websocket.Conn) *Client {
	return &Client{conn: conn, out: make(chan outbound, 128), done: make(chan struct{}), pending: make(map[string]time.Time)}
}

func (c *Client) trackPing(id string, sent time.Time) {
	c.pingMu.Lock()
	if len(c.pending) >= maxPendingPings {
		var oldestID string
		var oldest time.Time
		for pendingID, timestamp := range c.pending {
			if oldestID == "" || timestamp.Before(oldest) {
				oldestID, oldest = pendingID, timestamp
			}
		}
		delete(c.pending, oldestID)
	}
	c.pending[id] = sent
	c.pingMu.Unlock()
}

func (c *Client) takePing(id string) (time.Time, bool) {
	c.pingMu.Lock()
	defer c.pingMu.Unlock()
	sent, ok := c.pending[id]
	if ok {
		delete(c.pending, id)
	}
	return sent, ok
}

func (c *Client) startWriter() {
	c.writerOnce.Do(func() {
		go func() {
			for {
				select {
				case <-c.done:
					return
				case message := <-c.out:
					select {
					case <-c.done:
						return
					default:
					}
					_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
					if err := c.conn.WriteMessage(message.messageType, message.payload); err != nil {
						c.finishClose()
						return
					}
					if message.closeAfter {
						c.finishClose()
						return
					}
				}
			}
		}()
	})
}

func (c *Client) Send(value any) error {
	if _, shouldClose := value.(protocol.CloseMessage); shouldClose {
		return c.sendAndClose(value)
	}
	return c.enqueue(value)
}

func (c *Client) enqueue(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if rumble, ok := value.(protocol.Rumble); ok {
		return c.enqueueRumble(rumble, payload)
	}
	select {
	case <-c.done:
		return errors.New("client connection is closed")
	case c.out <- outbound{messageType: websocket.TextMessage, payload: payload}:
		return nil
	default:
		c.finishClose()
		return errors.New("client outbound queue is full")
	}
}

// enqueueRumble coalesces duplicate rumble spam and never silently drops a
// STOP. A delivered START with a lost STOP leaves the phone buzzing until
// its vibration clamp expires (~10s), so on a full queue a STOP evicts the
// oldest pending message (stale START spam) to make room for itself.
func (c *Client) enqueueRumble(rumble protocol.Rumble, payload []byte) error {
	c.rumbleMu.Lock()
	if c.hasRumble && c.lastRumble == rumble && time.Since(c.lastRumbleAt) < rumbleRefreshInterval {
		c.rumbleMu.Unlock()
		return nil
	}
	c.rumbleMu.Unlock()
	message := outbound{messageType: websocket.TextMessage, payload: payload}
	select {
	case <-c.done:
		return errors.New("client connection is closed")
	case c.out <- message:
		c.noteRumbleSent(rumble)
		return nil
	default:
	}
	if rumble.Active {
		log.Printf("ff: START dropped, outbound queue full (mag=%d:%d)", rumble.Strong, rumble.Weak)
		return errors.New("client outbound queue is full")
	}
	log.Printf("ff: queue full, evicting oldest to make room for STOP")
	select {
	case <-c.out:
	default:
	}
	select {
	case <-c.done:
		return errors.New("client connection is closed")
	case c.out <- message:
		c.noteRumbleSent(rumble)
		return nil
	default:
		return errors.New("client outbound queue is full")
	}
}

func (c *Client) noteRumbleSent(rumble protocol.Rumble) {
	c.rumbleMu.Lock()
	c.lastRumble = rumble
	c.hasRumble = true
	c.lastRumbleAt = time.Now()
	c.rumbleMu.Unlock()
}

func (c *Client) sendAndClose(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	c.closing.Store(true)
	select {
	case <-c.done:
		return errors.New("client connection is closed")
	case c.out <- outbound{messageType: websocket.TextMessage, payload: payload, closeAfter: true}:
		return nil
	default:
		c.finishClose()
		return errors.New("client outbound queue is full")
	}
}

func (c *Client) finishClose() {
	c.closeOnce.Do(func() { close(c.done); _ = c.conn.Close() })
}

func (c *Client) Close() {
	// A graceful close is in flight; the writer closes after it flushes the
	// final message. Hard-closing now would drop that message.
	if c.closing.Load() {
		return
	}
	c.finishClose()
}
