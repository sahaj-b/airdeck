package relay

import (
	"testing"
	"time"
)

func TestRateLimiterBudgetAndRecovery(t *testing.T) {
	now := time.Now()
	limiter := NewRateLimiter(2, time.Hour)
	limiter.Now = func() time.Time { return now }
	if !limiter.Allow("1.2.3.4") || !limiter.Allow("1.2.3.4") {
		t.Fatal("first two events must fit the budget")
	}
	if limiter.Allow("1.2.3.4") {
		t.Fatal("third event inside the window must be denied")
	}
	if !limiter.Allow("5.6.7.8") {
		t.Fatal("a different IP must have its own budget")
	}
	now = now.Add(time.Hour + time.Second)
	if !limiter.Allow("1.2.3.4") {
		t.Fatal("budget must recover once the window slides past")
	}
}

func TestReservedList(t *testing.T) {
	for _, code := range []string{"AIRDECK", "ADMIN", "HOST", "LOCAL", "TEST"} {
		if !IsReserved(code) {
			t.Fatalf("%s must be reserved", code)
		}
	}
	for _, code := range []string{"ABCD22", "PARTY2", "QWERTY"} {
		if IsReserved(code) {
			t.Fatalf("%s must not be reserved", code)
		}
	}
}

func TestDayStringIsUTCDate(t *testing.T) {
	fixed := time.Date(2026, 9, 12, 23, 30, 0, 0, time.FixedZone("UTC+5", 5*3600))
	if got := DayString(fixed); got != "2026-09-12" {
		t.Fatalf("DayString = %q, want 2026-09-12", got)
	}
}
