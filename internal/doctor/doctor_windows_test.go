//go:build windows

package doctor

import (
	"errors"
	"testing"
)

// errFakeBusMissing stands in for the ViGEmBus-missing failure path.
var errFakeBusMissing = errors.New("vigem: bus not found (install the ViGEmBus driver via airdeck setup)")

type fakeProbe struct {
	busErr error
	capErr error
}

func (f fakeProbe) check() (error, error) { return f.busErr, f.capErr }

func TestWindowsGateFailsWhenBusMissing(t *testing.T) {
	report, err := runWithProbe(func() error { return nil }, fakeProbe{busErr: errFakeBusMissing, capErr: errFakeBusMissing})
	if err == nil {
		t.Fatal("expected gate error when bus is missing")
	}
	found := false
	for _, check := range report.Checks {
		if check.Name == "vigembus connection" && !check.OK && check.Critical {
			found = true
		}
		if check.Name == "virtual-controller capability" && check.OK {
			t.Fatal("capability check must not pass when bus probe failed")
		}
	}
	if !found {
		t.Fatalf("bus check not critical-failed: %+v", report.Checks)
	}
}

func TestWindowsGatePassesWithHealthyBus(t *testing.T) {
	report, err := runWithProbe(func() error { return nil }, fakeProbe{})
	if err != nil {
		t.Fatalf("healthy probe returned error: %v (checks: %+v)", err, report.Checks)
	}
	for _, check := range report.Checks {
		if check.Critical && !check.OK {
			t.Fatalf("critical check failed: %+v", check)
		}
	}
}
