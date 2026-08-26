package diagnostics

import (
	"sync"
	"time"
)

type FrameTrace struct {
	Sequence      uint32        `json:"sequence"`
	ClientTime    uint64        `json:"clientTime"`
	ReceivedAt    time.Time     `json:"receivedAt"`
	AppliedAt     time.Time     `json:"appliedAt"`
	ApplyDuration time.Duration `json:"applyDuration"`
	Stale         bool          `json:"stale"`
	Watchdog      bool          `json:"watchdog"`
}

type Trace struct {
	mu      sync.Mutex
	entries []FrameTrace
	next    int
	full    bool
}

func NewTrace(capacity int) *Trace {
	if capacity < 1 {
		capacity = 1024
	}
	return &Trace{entries: make([]FrameTrace, capacity)}
}

func (t *Trace) Add(entry FrameTrace) {
	t.mu.Lock()
	t.entries[t.next] = entry
	t.next = (t.next + 1) % len(t.entries)
	if t.next == 0 {
		t.full = true
	}
	t.mu.Unlock()
}

func (t *Trace) Snapshot() []FrameTrace {
	t.mu.Lock()
	defer t.mu.Unlock()
	count := len(t.entries)
	start := t.next
	if !t.full {
		count = t.next
		start = 0
	}
	out := make([]FrameTrace, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, t.entries[(start+i)%len(t.entries)])
	}
	return out
}
