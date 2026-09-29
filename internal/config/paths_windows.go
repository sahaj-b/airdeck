//go:build windows

package config

import (
	"os"
	"path/filepath"
)

func Dir() string {
	if value := os.Getenv("AIRDECK_CONFIG_HOME"); value != "" {
		return value
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(".", ".config", "airdeck")
	}
	return filepath.Join(dir, "airdeck")
}
