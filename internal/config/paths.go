package config

import (
	"path/filepath"
)

func File() string       { return filepath.Join(Dir(), "config.json") }
func LayoutsDir() string { return filepath.Join(Dir(), "layouts") }
