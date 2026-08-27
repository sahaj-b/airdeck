package diagnostics

import (
	"sort"
	"sync"
	"time"
)

type ResourceSample struct {
	At              time.Time     `json:"at"`
	Players         int           `json:"players"`
	Goroutines      int           `json:"goroutines"`
	Memory          uint64        `json:"memoryBytes"`
	FileDescriptors int           `json:"fileDescriptors"`
	UserCPUTime     time.Duration `json:"userCpuTime"`
	SystemCPUTime   time.Duration `json:"systemCpuTime"`
}

const metricSampleCap = 8192

// durations is a fixed-capacity ring so per-frame recordings cannot grow
// without bound on a long-running host.
type durations struct {
	values []time.Duration
	next   int
	full   bool
}

func (d *durations) add(value time.Duration) {
	if d.values == nil {
		d.values = make([]time.Duration, metricSampleCap)
	}
	d.values[d.next] = value
	d.next = (d.next + 1) % len(d.values)
	if d.next == 0 {
		d.full = true
	}
}

func (d *durations) all() []time.Duration {
	if !d.full {
		return d.values[:d.next]
	}
	return d.values
}

type resourceRing struct {
	values []ResourceSample
	next   int
	full   bool
}

func (r *resourceRing) add(value ResourceSample) {
	if r.values == nil {
		r.values = make([]ResourceSample, 3600)
	}
	r.values[r.next] = value
	r.next = (r.next + 1) % len(r.values)
	if r.next == 0 {
		r.full = true
	}
}

func (r *resourceRing) all() []ResourceSample {
	if r.values == nil {
		return nil
	}
	if !r.full {
		out := make([]ResourceSample, r.next)
		copy(out, r.values[:r.next])
		return out
	}
	out := make([]ResourceSample, len(r.values))
	n := copy(out, r.values[r.next:])
	copy(out[n:], r.values[:r.next])
	return out
}

type Metrics struct {
	mu             sync.Mutex
	accepted       uint64
	rejected       uint64
	stale          uint64
	watchdogs      uint64
	watchdogDelay  durations
	applyDurations durations
	samples        resourceRing
}

type Summary struct {
	Accepted    uint64           `json:"acceptedFrames"`
	Rejected    uint64           `json:"rejectedFrames"`
	Stale       uint64           `json:"staleFrames"`
	Watchdogs   uint64           `json:"watchdogCount"`
	P50         time.Duration    `json:"p50"`
	P95         time.Duration    `json:"p95"`
	P99         time.Duration    `json:"p99"`
	Max         time.Duration    `json:"max"`
	WatchdogP50 time.Duration    `json:"watchdogP50"`
	WatchdogP95 time.Duration    `json:"watchdogP95"`
	WatchdogMax time.Duration    `json:"watchdogMax"`
	Resources   []ResourceSample `json:"resources"`
}

func (m *Metrics) Accepted() { m.mu.Lock(); m.accepted++; m.mu.Unlock() }
func (m *Metrics) Rejected() { m.mu.Lock(); m.rejected++; m.mu.Unlock() }
func (m *Metrics) Stale()    { m.mu.Lock(); m.stale++; m.mu.Unlock() }
func (m *Metrics) Watchdog(delay time.Duration) {
	m.mu.Lock()
	m.watchdogs++
	m.watchdogDelay.add(delay)
	m.mu.Unlock()
}

func (m *Metrics) Apply(duration time.Duration) {
	m.mu.Lock()
	m.applyDurations.add(duration)
	m.mu.Unlock()
}

func (m *Metrics) Resource(sample ResourceSample) {
	m.mu.Lock()
	m.samples.add(sample)
	m.mu.Unlock()
}

func (m *Metrics) Summary() Summary {
	m.mu.Lock()
	defer m.mu.Unlock()
	return Summary{Accepted: m.accepted, Rejected: m.rejected, Stale: m.stale, Watchdogs: m.watchdogs, P50: percentile(m.applyDurations.all(), .50), P95: percentile(m.applyDurations.all(), .95), P99: percentile(m.applyDurations.all(), .99), Max: maximum(m.applyDurations.all()), WatchdogP50: percentile(m.watchdogDelay.all(), .50), WatchdogP95: percentile(m.watchdogDelay.all(), .95), WatchdogMax: maximum(m.watchdogDelay.all()), Resources: m.samples.all()}
}

func percentile(values []time.Duration, fraction float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	copyValues := append([]time.Duration(nil), values...)
	sort.Slice(copyValues, func(i, j int) bool { return copyValues[i] < copyValues[j] })
	index := int(float64(len(copyValues)-1) * fraction)
	return copyValues[index]
}

func maximum(values []time.Duration) time.Duration {
	var max time.Duration
	for _, value := range values {
		if value > max {
			max = value
		}
	}
	return max
}
