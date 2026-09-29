//go:build windows

package device

import "testing"

func TestDefaultFactoryWindows(t *testing.T) {
	if _, ok := DefaultFactory().(*ViGEmFactory); !ok {
		t.Fatalf("DefaultFactory = %T, want *ViGEmFactory", DefaultFactory())
	}
}
