package input

import (
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/diagnostics"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/session"
)

const WatchdogTimeout = 200 * time.Millisecond

type Handler struct {
	session     *session.Session
	trace       *diagnostics.Trace
	metrics     *diagnostics.Metrics
	mu          sync.Mutex
	timers      map[string]*time.Timer
	clientTimes map[string]clientSample
}

// clientSample is the latest sampled debug.inputTrace from one player.
type clientSample struct {
	sequence   uint32
	clientTime uint64
}

func NewHandler(s *session.Session, trace *diagnostics.Trace, metrics *diagnostics.Metrics) *Handler {
	return &Handler{session: s, trace: trace, metrics: metrics, timers: make(map[string]*time.Timer), clientTimes: make(map[string]clientSample)}
}

func (h *Handler) Handle(id string, generation uint64, frame protocol.Frame) error {
	received := time.Now()
	clientTime := h.takeClientTime(id, frame.Seq)
	accepted, err := h.session.AcceptSequence(id, generation, frame.Seq)
	if err != nil {
		h.metrics.Rejected()
		return err
	}
	if !accepted {
		h.metrics.Stale()
		h.metrics.Rejected()
		h.trace.Add(diagnostics.FrameTrace{Sequence: frame.Seq, ClientTime: clientTime, ReceivedAt: received, Stale: true})
		return nil
	}
	applyStart := time.Now()
	if err := h.session.ApplyInput(id, generation, frame); err != nil {
		h.metrics.Rejected()
		return err
	}
	applied := time.Now()
	duration := applied.Sub(applyStart)
	h.metrics.Accepted()
	h.metrics.Apply(duration)
	h.trace.Add(diagnostics.FrameTrace{PlayerID: id, Sequence: frame.Seq, ClientTime: clientTime, ReceivedAt: received, AppliedAt: applied, ApplyDuration: duration})
	h.resetWatchdog(id, generation, received)
	return nil
}

func (h *Handler) resetWatchdog(id string, generation uint64, received time.Time) {
	h.mu.Lock()
	if timer := h.timers[id]; timer != nil {
		timer.Stop()
	}
	var timer *time.Timer
	timer = time.AfterFunc(WatchdogTimeout, func() {
		fired := time.Now()
		h.mu.Lock()
		current := h.timers[id] == timer
		if current {
			delete(h.timers, id)
		}
		h.mu.Unlock()
		if !current {
			return
		}
		if err := h.session.MarkStale(id, generation); err == nil {
			delay := fired.Sub(received)
			h.metrics.Watchdog(delay)
			h.trace.Add(diagnostics.FrameTrace{PlayerID: id, ReceivedAt: received, Watchdog: true})
		}
	})
	h.timers[id] = timer
	h.mu.Unlock()
}

func (h *Handler) Disconnect(id string, generation uint64) error {
	h.mu.Lock()
	if timer := h.timers[id]; timer != nil {
		timer.Stop()
		delete(h.timers, id)
	}
	delete(h.clientTimes, id)
	h.mu.Unlock()
	return h.session.Disconnect(id, generation)
}

func (h *Handler) Close() {
	h.mu.Lock()
	for id, timer := range h.timers {
		timer.Stop()
		delete(h.timers, id)
	}
	h.mu.Unlock()
}

// NoteClientTime stores a sampled debug.inputTrace so the next matching
// frame can carry its client monotonic send time into the trace.
func (h *Handler) NoteClientTime(id string, sequence uint32, clientTime uint64) {
	h.mu.Lock()
	h.clientTimes[id] = clientSample{sequence: sequence, clientTime: clientTime}
	h.mu.Unlock()
}

func (h *Handler) takeClientTime(id string, sequence uint32) uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	sample, ok := h.clientTimes[id]
	if !ok || sample.sequence != sequence {
		return 0
	}
	delete(h.clientTimes, id)
	return sample.clientTime
}

func (h *Handler) Metrics() diagnostics.Summary { return h.metrics.Summary() }

func (h *Handler) TraceSnapshot() []diagnostics.FrameTrace { return h.trace.Snapshot() }
