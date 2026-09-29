//go:build linux

package main

import (
	"fmt"
	"os"
)

func mustNotBeRoot() error {
	if os.Geteuid() == 0 {
		return fmt.Errorf("serve must run as your normal user, not as root; run it without sudo")
	}
	return nil
}

func warnIfRoot() {
	if os.Geteuid() == 0 {
		fmt.Fprintln(os.Stderr, paint(colorYellow, "warning: doctor as root checks root's access, not yours; rerun as your normal user"))
	}
}
