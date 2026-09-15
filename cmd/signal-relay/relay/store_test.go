package relay

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

// Concurrent registers for one code must elect exactly one winner: the
// atomic claim-and-register gate.
func TestConcurrentClaimOneWinner(t *testing.T) {
	store := openTestStore(t)
	const racers = 16
	var wins atomic.Int64
	var wg sync.WaitGroup
	errs := make([]error, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := store.Register("RACE22", fmt.Sprintf("key-%d", i))
			if err == nil {
				wins.Add(1)
			} else {
				errs[i] = err
			}
		}(i)
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("winners = %d, want exactly 1", wins.Load())
	}
	for i, err := range errs {
		if err == nil {
			continue
		}
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("loser %d error = %v, want ErrConflict", i, err)
		}
	}
}

// A changed code tombstones forever: a second installation gets a
// conflict, and so does the installation that burned it.
func TestTombstoneNeverReassign(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.Register("BURN22", "key-a"); err != nil {
		t.Fatalf("initial claim: %v", err)
	}
	result, err := store.Register("NEXT22", "key-a")
	if err != nil {
		t.Fatalf("code change: %v", err)
	}
	if result.ChangedFrom != "BURN22" {
		t.Fatalf("ChangedFrom = %q, want BURN22", result.ChangedFrom)
	}
	if _, err := store.Register("BURN22", "key-b"); !errors.Is(err, ErrConflict) {
		t.Fatalf("second installation claimed retired code, err = %v", err)
	}
	if _, err := store.Register("BURN22", "key-a"); !errors.Is(err, ErrConflict) {
		t.Fatalf("original owner reclaimed retired code, err = %v", err)
	}
	if _, err := store.Register("NEXT22", "key-b"); !errors.Is(err, ErrConflict) {
		t.Fatalf("second installation stole active code, err = %v", err)
	}
}

// Re-registering the same active code is a reconnect, not a change.
func TestReconnectSameCode(t *testing.T) {
	store := openTestStore(t)
	if _, err := store.Register("STAY22", "key-a"); err != nil {
		t.Fatalf("initial claim: %v", err)
	}
	result, err := store.Register("STAY22", "key-a")
	if err != nil {
		t.Fatalf("re-register: %v", err)
	}
	if result.ChangedFrom != "" {
		t.Fatalf("re-register = %+v, want reconnect without change", result)
	}
}

func TestChangeCountRoundTrip(t *testing.T) {
	store := openTestStore(t)
	if count, err := store.ChangeCount("key-a", "2026-09-12"); err != nil || count != 0 {
		t.Fatalf("fresh count = %d, %v; want 0", count, err)
	}
	for i := 1; i <= 2; i++ {
		if err := store.RecordChange("key-a", "2026-09-12"); err != nil {
			t.Fatalf("record change: %v", err)
		}
		if count, _ := store.ChangeCount("key-a", "2026-09-12"); count != i {
			t.Fatalf("count = %d, want %d", count, i)
		}
	}
	if count, _ := store.ChangeCount("key-a", "2026-09-13"); count != 0 {
		t.Fatalf("next-day count = %d, want 0", count)
	}
}
