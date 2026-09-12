package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsAndOverrides(t *testing.T) {
	cfg := Defaults()
	bind := "127.0.0.1"
	port := 7000
	updated, err := ApplyOverrides(cfg, Overrides{Bind: &bind, Port: &port})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Bind != bind || updated.Port != port || updated.InputRate != 60 {
		t.Fatalf("unexpected config: %+v", updated)
	}
}

func TestSaveLoadIsAtomicAndPrivate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "config.json")
	cfg := Defaults()
	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 600", info.Mode().Perm())
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != cfg {
		t.Fatalf("loaded config = %+v, want %+v", loaded, cfg)
	}
}

func TestLoadRejectsFutureAndLegacyVersion(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	legacy := map[string]any{"version": 0, "port": 7001}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("legacy version 0 should be rejected")
	}
	future := map[string]any{"version": CurrentVersion + 1}
	data, _ = json.Marshal(future)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("future config version was accepted")
	}
}

func TestLoadRejectsGarbageConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("garbage config was accepted")
	}
}

func TestDefaultsGenerateRoomIdentity(t *testing.T) {
	first := Defaults()
	if first.RoomCode == "" || first.InstallationKey == "" {
		t.Fatal("defaults must generate roomCode and installationKey")
	}
	if err := Validate(first); err != nil {
		t.Fatalf("defaults failed validation: %v", err)
	}
	second := Defaults()
	if first.RoomCode == second.RoomCode || first.InstallationKey == second.InstallationKey {
		t.Fatal("defaults must generate fresh identity per call")
	}
}

func TestLoadFailsOldFileWithDeleteHint(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	// Pre-room-code file: valid v1 shape but no roomCode/installationKey.
	legacy := map[string]any{"version": 1, "port": 6969, "bind": "0.0.0.0", "defaultLayout": "xbox-default", "inputRate": 60, "gracePeriodSeconds": 5}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Load(path)
	if err == nil {
		t.Fatal("old file without room identity should be rejected")
	}
	msg := err.Error()
	if !strings.Contains(msg, "delete") || !strings.Contains(msg, path) {
		t.Fatalf("error %q should point at deleting %s to regenerate", msg, path)
	}
}

func TestFirstRunGeneratesAndSavesBack(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nested", "config.json")
	first, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if first.RoomCode == "" || first.InstallationKey == "" {
		t.Fatal("first run must generate room identity")
	}
	second, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if first.RoomCode != second.RoomCode || first.InstallationKey != second.InstallationKey {
		t.Fatal("second load must return the saved identity, not rotate")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 600", info.Mode().Perm())
	}
}

func TestLoadNormalizesHandEditedRoomCode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	cfg := Defaults()
	want := cfg.RoomCode // Generate() output is already canonical.
	// Lowercase + dash + space must canonicalize on load.
	cfg.RoomCode = strings.ToLower(want[:3]+"-"+want[3:]) + " "
	data, _ := json.Marshal(cfg)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.RoomCode != want {
		t.Fatalf("loaded roomCode = %q, want normalized %q", loaded.RoomCode, want)
	}
}

func TestLoadRejectsNonHexInstallationKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	cfg := Defaults()
	cfg.InstallationKey = strings.Repeat("Z", 64)
	data, _ := json.Marshal(cfg)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("64-char non-hex installation key should be rejected")
	}
}

func TestRoomCodeAndLanOnlyOverrides(t *testing.T) {
	code := "ab-cd 2e"
	lanOnly := true
	approval := true
	updated, err := ApplyOverrides(Defaults(), Overrides{RoomCode: &code, LanOnly: &lanOnly, ApprovalRequired: &approval})
	if err != nil {
		t.Fatal(err)
	}
	if updated.RoomCode != "ABCD2E" {
		t.Fatalf("roomCode override = %q, want normalized ABCD2E", updated.RoomCode)
	}
	if !updated.LanOnly || !updated.ApprovalRequired {
		t.Fatalf("overrides not applied: %+v", updated)
	}
	bad := "00-00"
	if _, err := ApplyOverrides(Defaults(), Overrides{RoomCode: &bad}); err == nil {
		t.Fatal("ambiguous roomCode override should be rejected")
	}
}

func TestNoCodeOverride(t *testing.T) {
	noCode := true
	updated, err := ApplyOverrides(Defaults(), Overrides{NoCode: &noCode})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.NoCode {
		t.Fatal("expected NoCode override to apply")
	}
}

func TestGracePeriodDefault(t *testing.T) {
	cfg := Defaults()
	if cfg.GracePeriodSeconds != 5 {
		t.Fatalf("grace period default = %d, want 5", cfg.GracePeriodSeconds)
	}
}

func TestGracePeriodOverride(t *testing.T) {
	val := 15
	updated, err := ApplyOverrides(Defaults(), Overrides{GracePeriodSeconds: &val})
	if err != nil {
		t.Fatal(err)
	}
	if updated.GracePeriodSeconds != 15 {
		t.Fatalf("grace period = %d, want 15", updated.GracePeriodSeconds)
	}
}

func TestGracePeriodValidationRejectsZero(t *testing.T) {
	cfg := Defaults()
	cfg.GracePeriodSeconds = 0
	if err := Validate(cfg); err == nil {
		t.Fatal("zero grace period should be rejected")
	}
}

func TestGracePeriodValidationRejectsOutOfRange(t *testing.T) {
	cfg := Defaults()
	cfg.GracePeriodSeconds = 301
	if err := Validate(cfg); err == nil {
		t.Fatal("grace period > 300 should be rejected")
	}
}
