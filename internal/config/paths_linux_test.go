//go:build linux

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDirLinuxXDG(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg-test")
	if got := Dir(); got != filepath.Join("/tmp/xdg-test", "airdeck") {
		t.Fatalf("Dir = %q", got)
	}
}

func TestDirLinuxHome(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home dir")
	}
	if got := Dir(); got != filepath.Join(home, ".config", "airdeck") {
		t.Fatalf("Dir = %q", got)
	}
}

func TestFileAndLayoutsUnderDir(t *testing.T) {
	if !strings.HasPrefix(File(), Dir()) || !strings.HasPrefix(LayoutsDir(), Dir()) {
		t.Fatalf("File=%q Layouts=%q not under Dir=%q", File(), LayoutsDir(), Dir())
	}
}
