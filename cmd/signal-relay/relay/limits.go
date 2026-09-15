package relay

import (
	"sync"
	"time"
)

// MaxCodeChangesPerDay caps code changes per key per UTC day.
const MaxCodeChangesPerDay = 5

// DayString buckets code-change counts by UTC calendar day.
func DayString(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// reservedCodes never claim, even for the first asker.
var reservedCodes = map[string]bool{
	"AIRDECK": true,
	"ADMIN":   true,
	"HOST":    true,
	"LOCAL":   true,
	"TEST":    true,
}

// IsReserved reports whether a normalized code is unclaimable.
func IsReserved(normalized string) bool {
	return reservedCodes[normalized]
}

// RateLimiter is a per-key sliding-window limiter for host registrations.
type RateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
	// Now is a test hook; production leaves it nil (time.Now).
	Now func() time.Time
}

// NewRateLimiter allows max events per window per key.
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return &RateLimiter{max: max, window: window, hits: make(map[string][]time.Time)}
}

// RegistrationLimit is 10 registers per IP per minute.
const (
	RegistrationLimit  = 10
	RegistrationWindow = time.Minute
)

func (l *RateLimiter) now() time.Time {
	if l.Now != nil {
		return l.Now()
	}
	return time.Now()
}

// Allow reports whether one more event for key fits the budget.
func (l *RateLimiter) Allow(key string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	// Bound memory: fresh-IP scans otherwise grow the map forever.
	// Sweep once the table gets large; per-key hits stay tiny.
	if len(l.hits) > 4096 {
		for k, hits := range l.hits {
			kept := hits[:0]
			for _, hit := range hits {
				if now.Sub(hit) < l.window {
					kept = append(kept, hit)
				}
			}
			if len(kept) == 0 {
				delete(l.hits, k)
			} else {
				l.hits[k] = kept
			}
		}
	}
	kept := l.hits[key][:0]
	for _, hit := range l.hits[key] {
		if now.Sub(hit) < l.window {
			kept = append(kept, hit)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}
