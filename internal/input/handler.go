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
	h.resetWatchdog(id, generation)
	return nil
}

type watchdogEntry struct {
	timer      *time.Timer
	generation uint64
	deadline   time.Time
}

func (h *Handler) resetWatchdog(id string, generation uint64) {
	h.mu.Lock()
	now := time.Now()
	entry, exists := h.timers[id]
	if exists {
		entry.generation = generation
		entry.deadline = now.Add(WatchdogTimeout)
		entry.timer.Reset(WatchdogTimeout)
		h.mu.Unlock()
		return
	}
	entry = &watchdogEntry{generation: generation, deadline: now.Add(WatchdogTimeout)}
	entry.timer = time.AfterFunc(WatchdogTimeout, func() {
		h.mu.Lock()
		current := h.timers[id]
		if current != entry {
			h.mu.Unlock()
			return
		}
		if time.Now().Before(entry.deadline) {
			entry.timer.Reset(time.Until(entry.deadline))
			h.mu.Unlock()
			return
		}
		delete(h.timers, id)
		gen := entry.generation
		h.mu.Unlock()
		_ = h.session.MarkStaleIfIdle(id, gen, WatchdogTimeout)
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
