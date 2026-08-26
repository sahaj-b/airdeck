package transport

import (
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/protocol"
)

type outbound struct {
	messageType int
	payload     []byte
}

const maxPendingPings = 8

type Client struct {
	conn      *websocket.Conn
	out       chan outbound
	done      chan struct{}
	closeOnce sync.Once
	pingMu    sync.Mutex
	pending   map[string]time.Time
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
					c.Close()
					return
				}
			}
		}
	}()
}

func (c *Client) Send(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	select {
	case <-c.done:
		return errors.New("client connection is closed")
	case c.out <- outbound{messageType: websocket.TextMessage, payload: payload}:
		return nil
	default:
		if _, isRumble := value.(protocol.Rumble); !isRumble {
			c.Close()
		}
		return errors.New("client outbound queue is full")
	}
}

func (c *Client) Close() {
	c.closeOnce.Do(func() { close(c.done); _ = c.conn.Close() })
}
