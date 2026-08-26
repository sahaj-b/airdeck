package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuleGrantsUInputToInputGroup(t *testing.T) {
	if !strings.Contains(Rule, `KERNEL=="uinput"`) || !strings.Contains(Rule, `GROUP="input"`) || !strings.Contains(Rule, `MODE:="0660"`) {
		t.Fatalf("unexpected udev rule: %s", Rule)
	}
}

func TestInstallRuleIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "99-airdeck-uinput.rules")
	already, err := installRule(path)
	if err != nil {
		t.Fatal(err)
	}
	if already {
		t.Fatal("first install returned already-installed")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != Rule+"\n" {
		t.Fatalf("rule content = %q, want %q", data, Rule+"\n")
	}
	already, err = installRule(path)
	if err != nil {
		t.Fatal(err)
	}
	if !already {
		t.Fatal("second install did not detect already-installed")
	}
	// Changing the content should trigger a reinstall.
	if err := os.WriteFile(path, []byte(`GARBAGE`), 0o644); err != nil {
		t.Fatal(err)
	}
	already, err = installRule(path)
	if err != nil {
		t.Fatal(err)
	}
	if already {
		t.Fatal("install did not detect content change")
	}
	data, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != Rule+"\n" {
		t.Fatalf("content after reinstall = %q", data)
	}
}
