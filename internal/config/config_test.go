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
