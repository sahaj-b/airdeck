//go:build linux

package config

import (
	"os"
	"path/filepath"
)

func Dir() string {
	if value := os.Getenv("XDG_CONFIG_HOME"); value != "" {
		return filepath.Join(value, "airdeck")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".config", "airdeck")
	}
	return filepath.Join(home, ".config", "airdeck")
}
