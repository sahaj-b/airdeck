package config

import (
	"encoding/json"
	"os"
	"path/filepath"
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

func TestLoadMigratesVersionZeroAndRejectsFuture(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	legacy := map[string]any{"version": 0, "port": 7001}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Version != CurrentVersion || cfg.Bind != "0.0.0.0" || cfg.InputRate != 60 {
		t.Fatalf("migration failed: %+v", cfg)
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

func TestGracePeriodMigratesFromZero(t *testing.T) {
	cfg := migrate(Config{Version: 0, GracePeriodSeconds: 0})
	if cfg.GracePeriodSeconds != 5 {
		t.Fatalf("grace period after migration = %d, want 5", cfg.GracePeriodSeconds)
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
