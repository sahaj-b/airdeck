//go:build linux

package device

import "testing"

func TestDefaultFactoryLinux(t *testing.T) {
	if _, ok := DefaultFactory().(UInputFactory); !ok {
		t.Fatalf("DefaultFactory = %T, want UInputFactory", DefaultFactory())
	}
}
