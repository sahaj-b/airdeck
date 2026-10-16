package input

import (
	"log"
	"os"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
)

const WatchdogTimeout = 200 * time.Millisecond

// slowApplyThreshold logs one line per offending frame: ApplyInput covers
// the session lock plus the uinput writes, so a slow device write shows up
// here instead of hiding inside a ping spike.
const slowApplyThreshold = 10 * time.Millisecond

// inputDebug enables per-second input fps plus max Apply latency per
// player for joystick experiments: AIRDECK_INPUT_DEBUG=1 airdeck serve.
// Off by default; the Handle fast path only reads one bool when off.
var inputDebug = os.Getenv("AIRDECK_INPUT_DEBUG") != ""

type debugWindow struct {
	start      time.Time
	frames     int
	stale      int
	maxLatency time.Duration
}

type Handler struct {
	session *session.Session
	mu      sync.Mutex
	timers  map[string]*watchdogEntry
	debugMu sync.Mutex
	windows map[string]*debugWindow
}

func NewHandler(s *session.Session) *Handler {
	return &Handler{session: s, timers: make(map[string]*watchdogEntry)}
}

func (h *Handler) Handle(id string, generation uint64, frame protocol.Frame) error {
	var start time.Time
	if inputDebug {
		start = time.Now()
	}
	accepted, err := h.session.AcceptSequence(id, generation, frame.Seq)
	if err != nil {
		log.Printf("input rejected player %s seq %d: %v", id, frame.Seq, err)
		return err
	}
	if !accepted {
		if inputDebug {
			log.Printf("input stale player %s seq %d", id, frame.Seq)
		}
		h.trackDebug(id, start, true)
		return nil
	}
	if err := h.session.ApplyInput(id, generation, frame); err != nil {
		log.Printf("input apply rejected player %s seq %d: %v", id, frame.Seq, err)
		return err
	}
	h.resetWatchdog(id, generation)
	h.trackDebug(id, start, false)
	return nil
}

// trackDebug folds one frame into the per-player one-second window and
// logs fps plus worst Apply latency. Slow frames log immediately with
// their latency so a blocking uinput write is caught red-handed.
func (h *Handler) trackDebug(id string, start time.Time, stale bool) {
	if !inputDebug {
		return
	}
	latency := time.Since(start)
	if latency >= slowApplyThreshold {
		log.Printf("input slow player %s latency=%s stale=%v", id, latency, stale)
	}
	now := time.Now()
	h.debugMu.Lock()
	// Bound churn: random player IDs over a long uptime must not grow
	// this map forever when debug is on. Evict the stalest window (its
	// start is the last second bucket it logged, so a live player is
	// never the oldest) and never the caller's own.
	if h.windows != nil && len(h.windows) >= 128 {
		oldestID := ""
		var oldestStart time.Time
		for key, window := range h.windows {
			if key == id || window == nil {
				continue
			}
			if oldestID == "" || window.start.Before(oldestStart) {
				oldestID, oldestStart = key, window.start
			}
		}
		delete(h.windows, oldestID)
	}
	window, ok := h.windows[id]
	if !ok || window == nil {
		window = &debugWindow{start: now}
		if h.windows == nil {
			h.windows = make(map[string]*debugWindow)
		}
		h.windows[id] = window
	}
	window.frames++
	if stale {
		window.stale++
	}
	if latency > window.maxLatency {
		window.maxLatency = latency
	}
	if now.Sub(window.start) >= time.Second {
		log.Printf("input dbg player %s fps=%d stale=%d maxApply=%s", id, window.frames, window.stale, window.maxLatency)
		window.start = now
		window.frames = 0
		window.stale = 0
		window.maxLatency = 0
	}
	h.debugMu.Unlock()
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
	h.debugMu.Lock()
	delete(h.windows, id)
	h.debugMu.Unlock()
	return h.session.Disconnect(id, generation)
}

func (h *Handler) Close() {
	h.mu.Lock()
	for id, entry := range h.timers {
		entry.timer.Stop()
		delete(h.timers, id)
	}
	h.mu.Unlock()
	h.debugMu.Lock()
	h.windows = nil
	h.debugMu.Unlock()
}
