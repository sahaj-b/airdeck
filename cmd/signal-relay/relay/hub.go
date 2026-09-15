package relay

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/turn"
)

const (
	// maxFrameBytes caps one signaling frame. SDP offers run a few KB;
	// 64KB leaves headroom while bounding a malicious guest.
	maxFrameBytes = 64 * 1024
	// sendQueue bounds one slow phone so it cannot stall the relay.
	sendQueue = 128
	// pingInterval keeps approval-mode waits alive through proxy idle
	// timeouts; pongWait bounds a dead peer.
	pingInterval = 30 * time.Second
	pongWait     = 90 * time.Second
	writeTimeout = 5 * time.Second
)

// Hub routes joins between hosts and guests and owns the pending queue.
// All maps are guarded by mu; websocket I/O never holds it.
type Hub struct {
	mu             sync.Mutex
	store          *Store
	turn           *turn.Provider
	enforceLimits  bool
	registerLimits *RateLimiter
	hosts          map[string]*hostConn // normalized code -> host
	pendings       map[string]*pending  // pendingID -> entry
	routes         map[string]*route    // correlationID -> guest route
	now            func() time.Time
}

// pending is one approval-mode join waiting on the host. It lives exactly
// while the guest stays connected: socket close evaporates it, no timers.
type pending struct {
	id           string
	displayName  string
	reconnectID  string
	waitingSince int64
	guest        *guestConn
	host         *hostConn
}

// route maps one relay-assigned correlation id to the guest waiting for
// its answer. open marks an open-mode join flow (guest expects joined);
// otherwise it is a post-accept offer flow (guest expects answer).
type route struct {
	guest     *guestConn
	host      *hostConn
	pendingID string
	open      bool
}

// NewHub wires a store to a TURN provider.
func NewHub(store *Store, provider *turn.Provider, enforceLimits bool) *Hub {
	if provider == nil {
		provider = turn.New("", "")
	}
	return &Hub{
		store:          store,
		turn:           provider,
		enforceLimits:  enforceLimits,
		registerLimits: NewRateLimiter(RegistrationLimit, RegistrationWindow),
		hosts:          make(map[string]*hostConn),
		pendings:       make(map[string]*pending),
		routes:         make(map[string]*route),
		now:            time.Now,
	}
}

// limited reports whether one abuse-limit violation blocks the caller.
func (h *Hub) limited(reason string) bool {
	if !h.enforceLimits {
		log.Printf("relay: limit bypassed (enforce-limits off): %s", reason)
		return false
	}
	return true
}

// hostConn is one /register socket. code tracks the current claim so a
// second register on the same socket (dashboard code change) re-routes.
type hostConn struct {
	conn             *websocket.Conn
	send             chan []byte
	done             chan struct{}
	closeOnce        sync.Once
	code             string
	approvalRequired bool
}

type guestConn struct {
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
	pending   map[string]*pending
}

func newHostConn(conn *websocket.Conn) *hostConn {
	return &hostConn{conn: conn, send: make(chan []byte, sendQueue), done: make(chan struct{})}
}

func newGuestConn(conn *websocket.Conn) *guestConn {
	return &guestConn{conn: conn, send: make(chan []byte, sendQueue), done: make(chan struct{}), pending: make(map[string]*pending)}
}

func writeJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		// All relay messages are static structs; a marshal failure is a bug.
		panic(err)
	}
	return data
}

func (c *hostConn) enqueue(value any) {
	select {
	case <-c.done:
		return
	case c.send <- writeJSON(value):
	default:
		log.Printf("relay: host %s outbound full, dropping message", c.code)
	}
}

func (c *guestConn) enqueue(value any) {
	select {
	case <-c.done:
		return
	case c.send <- writeJSON(value):
	default:
		log.Printf("relay: guest outbound full, dropping message")
	}
}

func (c *hostConn) finishClose() {
	c.closeOnce.Do(func() { close(c.done); _ = c.conn.Close() })
}

func (c *guestConn) finishClose() {
	c.closeOnce.Do(func() { close(c.done); _ = c.conn.Close() })
}

// pumpWriter drains one connection queue on a single goroutine.
func pumpWriter(conn *websocket.Conn, out <-chan []byte, done <-chan struct{}, finish func()) {
	defer finish()
	for {
		select {
		case <-done:
			return
		case data := <-out:
			_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}
}

// keepalive sends ping frames until done closes and kills the read side
// when the peer stops answering.
func keepalive(conn *websocket.Conn, done <-chan struct{}) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func armPongs(conn *websocket.Conn) {
	conn.SetReadLimit(maxFrameBytes)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
}
