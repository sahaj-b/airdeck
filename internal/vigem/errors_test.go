package vigem

import (
	"strings"
	"testing"
)

func TestErrorStrings(t *testing.T) {
	if got := (Error(VigemErrorNone)).Error(); got == "" {
		t.Fatal("success error string is empty")
	}
	if got := (Error(VigemErrorBusNotFound)).Error(); !strings.Contains(got, "bus not found") {
		t.Fatalf("bus-not-found string = %q", got)
	}
	if got := (Error(0xDEAD)).Error(); !strings.Contains(got, "dead") {
		t.Fatalf("unknown code string = %q", got)
	}
}

func TestSucceeded(t *testing.T) {
	if !Succeeded(VigemErrorNone) {
		t.Fatal("VIGEM_ERROR_NONE should succeed")
	}
	if Succeeded(VigemErrorBusNotFound) {
		t.Fatal("BUS_NOT_FOUND should not succeed")
	}
}
