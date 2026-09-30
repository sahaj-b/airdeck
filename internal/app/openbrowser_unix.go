//go:build !windows

package app

import (
	"fmt"
	"os/exec"
	"runtime"
)

// openURL is the non-Windows fallback for serve --open. Linux stays opt-in
// via the flag default, so this path rarely runs outside darwin or manual use.
func openURL(url string) error {
	var name string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		name = "open"
		args = []string{url}
	default:
		name = "xdg-open"
		args = []string{url}
	}
	if _, err := exec.LookPath(name); err != nil {
		return fmt.Errorf("%s not found: %w", name, err)
	}
	return exec.Command(name, args...).Start()
}
