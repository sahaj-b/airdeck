package input

import (
	"log"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
)

const WatchdogTimeout = 200 * time.Millisecond

type Handler struct {
	session *session.Session
	mu      sync.Mutex
	timers  map[string]*watchdogEntry
}

func NewHandler(s *session.Session) *Handler {
	return &Handler{session: s, timers: make(map[string]*watchdogEntry)}
}

func (h *Handler) Handle(id string, generation uint64, frame protocol.Frame) error {
	received := time.Now()
	accepted, err := h.session.AcceptSequence(id, generation, frame.Seq)
	if err != nil {
		log.Printf("input rejected player %s seq %d: %v", id, frame.Seq, err)
		return err
	}
	if !accepted {
		log.Printf("input stale player %s seq %d", id, frame.Seq)
		return nil
	}
	if err := h.session.ApplyInput(id, generation, frame); err != nil {
		log.Printf("input apply rejected player %s seq %d: %v", id, frame.Seq, err)
		return err
	}
	h.resetWatchdog(id, generation, received)
	return nil
}

type watchdogEntry struct {
	timer      *time.Timer
	generation uint64
	received   time.Time
}

func (h *Handler) resetWatchdog(id string, generation uint64, received time.Time) {
	h.mu.Lock()
	entry, exists := h.timers[id]
	if exists {
		entry.generation = generation
		entry.received = received
		entry.timer.Reset(WatchdogTimeout)
		h.mu.Unlock()
		return
	}
	entry = &watchdogEntry{generation: generation, received: received}
	entry.timer = time.AfterFunc(WatchdogTimeout, func() {
		h.mu.Lock()
		current := h.timers[id]
		if current != entry {
			h.mu.Unlock()
			return
		}
		delete(h.timers, id)
		gen := entry.generation
		h.mu.Unlock()
		_ = h.session.MarkStale(id, gen)
	})
	h.timers[id] = entry
	h.mu.Unlock()
}

func (h *Handler) Disconnect(id string, generation uint64) error {
	h.mu.Lock()
	if entry := h.timers[id]; entry != nil {
		entry.timer.Stop()
		delete(h.timers, id)
	}
	h.mu.Unlock()
	return h.session.Disconnect(id, generation)
}

func (h *Handler) Close() {
	h.mu.Lock()
	for id, entry := range h.timers {
		entry.timer.Stop()
		delete(h.timers, id)
	}
	h.mu.Unlock()
}
