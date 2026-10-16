package relay

import (
	"database/sql"
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

// RegisterWithLimit spends the daily cap only on real code moves: a
// same-code re-register is a reconnect. A capped move must leave the
// active claim live and retire nothing.
func TestRegisterWithLimitCap(t *testing.T) {
	store := openTestStore(t)
	const day = "2026-09-12"
	if _, err := store.RegisterWithLimit("CAP222", "key-a", day, 2); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := store.RegisterWithLimit("CAP222", "key-a", day, 2); err != nil {
			t.Fatalf("reconnect %d: %v", i, err)
		}
	}
	if count, err := store.ChangeCount("key-a", day); err != nil || count != 0 {
		t.Fatalf("count after reconnects = %d, %v; want 0", count, err)
	}
	result, err := store.RegisterWithLimit("NEXT22", "key-a", day, 2)
	if err != nil || result.ChangedFrom != "CAP222" {
		t.Fatalf("first move = %+v, %v; want ChangedFrom CAP222", result, err)
	}
	result, err = store.RegisterWithLimit("THRD22", "key-a", day, 2)
	if err != nil || result.ChangedFrom != "NEXT22" {
		t.Fatalf("second move = %+v, %v; want ChangedFrom NEXT22", result, err)
	}
	if _, err := store.RegisterWithLimit("FOUR22", "key-a", day, 2); !errors.Is(err, ErrChangeLimit) {
		t.Fatalf("third move error = %v, want ErrChangeLimit", err)
	}
	if claim, err := store.Lookup("THRD22"); err != nil || claim.Retired {
		t.Fatalf("active claim after cap = %+v, %v; want live THRD22", claim, err)
	}
	if _, err := store.Lookup("FOUR22"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("capped code lookup error = %v, want no rows", err)
	}
	if count, err := store.ChangeCount("key-a", day); err != nil || count != 2 {
		t.Fatalf("count after cap = %d, %v; want 2", count, err)
	}
	if _, err := store.RegisterWithLimit("FOUR22", "key-a", "2026-09-13", 2); err != nil {
		t.Fatalf("next-day move: %v", err)
	}
}

// The cap lives inside the claim transaction: concurrent moves cannot both
// spend the same last change.
func TestConcurrentRegisterWithLimitOneChange(t *testing.T) {
	store := openTestStore(t)
	const day = "2026-09-12"
	if _, err := store.RegisterWithLimit("BASE22", "key-a", day, 1); err != nil {
		t.Fatalf("base claim: %v", err)
	}
	const racers = 8
	var wins, limits atomic.Int64
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := store.RegisterWithLimit(fmt.Sprintf("MOVE%02d", i), "key-a", day, 1)
			switch {
			case err == nil:
				wins.Add(1)
			case errors.Is(err, ErrChangeLimit):
				limits.Add(1)
			default:
				errs[i] = err
			}
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d error = %v, want nil or ErrChangeLimit", i, err)
		}
	}
	if wins.Load() != 1 {
		t.Fatalf("moves that won the last change = %d, want exactly 1", wins.Load())
	}
	if limits.Load() != racers-1 {
		t.Fatalf("moves limited = %d, want %d", limits.Load(), racers-1)
	}
	if count, err := store.ChangeCount("key-a", day); err != nil || count != 1 {
		t.Fatalf("count = %d, %v; want 1", count, err)
	}
}
