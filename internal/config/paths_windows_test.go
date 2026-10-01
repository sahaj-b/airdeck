//go:build windows

package config

import (
	"path/filepath"
	"testing"
)

func TestDirWindowsAppData(t *testing.T) {
	t.Setenv("AIRDECK_CONFIG_HOME", "")
	t.Setenv("APPDATA", `C:\Users\test\AppData\Roaming`)
	want := filepath.Join(`C:\Users\test\AppData\Roaming`, "airdeck")
	if got := Dir(); got != want {
		t.Fatalf("Dir = %q, want %q", got, want)
	}
}

func TestDirWindowsOverridePrecedence(t *testing.T) {
	t.Setenv("AIRDECK_CONFIG_HOME", `D:\custom\airdeck`)
	t.Setenv("APPDATA", `C:\Users\test\AppData\Roaming`)
	if got := Dir(); got != `D:\custom\airdeck` {
		t.Fatalf("Dir = %q, want override", got)
	}
}
