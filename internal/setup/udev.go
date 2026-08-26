package setup

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

const Rule = `KERNEL=="uinput", GROUP="input", MODE="0660"`

func Run() error {
	if os.Geteuid() != 0 {
		return errors.New("airdeck setup requires root; run setup through sudo, then run serve as your normal user")
	}
	if err := run("modprobe", "uinput"); err != nil {
		return fmt.Errorf("load uinput module: %w", err)
	}
	const rulePath = "/etc/udev/rules.d/99-airdeck-uinput.rules"
	if err := os.WriteFile(rulePath, []byte(Rule+"\n"), 0o644); err != nil {
		return fmt.Errorf("install %s: %w", rulePath, err)
	}
	if err := run("udevadm", "control", "--reload-rules"); err != nil {
		return fmt.Errorf("reload udev rules: %w", err)
	}
	if err := run("udevadm", "trigger", "--subsystem-match=misc", "--action=change"); err != nil {
		return fmt.Errorf("trigger udev rules: %w", err)
	}
	return nil
}

var run = func(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
