package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const CurrentVersion = 1

type Config struct {
	Version            int    `json:"version"`
	Port               int    `json:"port"`
	Bind               string `json:"bind"`
	AdvertisedHost     string `json:"advertisedHost"`
	AdvertisedPort     int    `json:"advertisedPort"`
	DefaultLayout      string `json:"defaultLayout"`
	InputRate          int    `json:"inputRate"`
	GracePeriodSeconds int    `json:"gracePeriodSeconds"`
	NoCode             bool   `json:"noCode"`
}

func Defaults() Config {
	return Config{Version: CurrentVersion, Port: 6969, Bind: "0.0.0.0", AdvertisedPort: 0, DefaultLayout: "xbox-default", InputRate: 60, GracePeriodSeconds: 5}
}

func Load(path string) (Config, error) {
	defaults := Defaults()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaults, nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := Validate(cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func Validate(cfg Config) error {
	if cfg.Version != CurrentVersion {
		return fmt.Errorf("unsupported config version %d", cfg.Version)
	}
	if cfg.Port < 0 || cfg.Port > 65535 || cfg.AdvertisedPort < 0 || cfg.AdvertisedPort > 65535 {
		return errors.New("config ports must be between 0 and 65535")
	}
	if cfg.InputRate < 1 || cfg.InputRate > 240 {
		return errors.New("input rate must be between 1 and 240")
	}
	if cfg.GracePeriodSeconds < 1 || cfg.GracePeriodSeconds > 300 {
		return errors.New("grace period must be between 1 and 300 seconds")
	}
	if cfg.Bind == "" || cfg.DefaultLayout == "" {
		return errors.New("config bind and default layout are required")
	}
	return nil
}

func Save(path string, cfg Config) error {
	if err := Validate(cfg); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*")
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("set config permissions: %w", err)
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("write config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}

type Overrides struct {
	Bind               *string
	Port               *int
	AdvertisedHost     *string
	AdvertisedPort     *int
	DefaultLayout      *string
	InputRate          *int
	GracePeriodSeconds *int
	NoCode             *bool
}

func ApplyOverrides(cfg Config, overrides Overrides) (Config, error) {
	if overrides.Bind != nil {
		cfg.Bind = *overrides.Bind
	}
	if overrides.Port != nil {
		cfg.Port = *overrides.Port
	}
	if overrides.AdvertisedHost != nil {
		cfg.AdvertisedHost = *overrides.AdvertisedHost
	}
	if overrides.AdvertisedPort != nil {
		cfg.AdvertisedPort = *overrides.AdvertisedPort
	}
	if overrides.DefaultLayout != nil {
		cfg.DefaultLayout = *overrides.DefaultLayout
	}
	if overrides.InputRate != nil {
		cfg.InputRate = *overrides.InputRate
	}
	if overrides.GracePeriodSeconds != nil {
		cfg.GracePeriodSeconds = *overrides.GracePeriodSeconds
	}
	if overrides.NoCode != nil {
		cfg.NoCode = *overrides.NoCode
	}
	return cfg, Validate(cfg)
}
