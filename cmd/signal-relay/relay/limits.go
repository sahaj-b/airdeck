package relay

import (
	"sync"
	"time"
)

// MaxCodeChangesPerDay caps code changes per installation key per UTC day.
// Single digits by SPEC: squatting damage is permanent under
// never-reassign, but a party host rotating codes must never hit this.
const MaxCodeChangesPerDay = 5

// DayString buckets code-change counts by UTC calendar day.
func DayString(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// reservedCodes is the tiny day-one reserved list. These never claim, even
// for the first installation that asks.
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
// Day one it guards register only; guest joins stay unlimited so a party
// room of 16 phones never trips it.
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

// RegistrationLimit is the day-one budget: 10 registers per IP per minute.
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

// Allow reports whether one more event for key fits the budget and records
// it when it does. Denied events are not recorded, so a bursting IP
// recovers exactly one window after its oldest hit ages out.
func (l *RateLimiter) Allow(key string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
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
