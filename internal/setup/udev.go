package setup

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
)

// MODE:= finalizes the assignment so a later rule (for example another
// project's 99-* uinput rule) cannot reopen the node. Airdeck's rule sorts
// first among 99-* rules, so finalizing here wins.
const Rule = `KERNEL=="uinput", GROUP="input", MODE:="0660"`

const (
	colorGreen  = "32"
	colorYellow = "33"
	colorBold   = "1"
	colorDim    = "2"
)

// colorsAreEnabled reports whether stdout is a terminal and NO_COLOR is unset.
func colorsAreEnabled() bool {
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	info, err := os.Stdout.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func paint(code, text string) string {
	if !colorsAreEnabled() {
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}

func green(text string) string  { return paint(colorGreen, text) }
func yellow(text string) string { return paint(colorYellow, text) }
func dim(text string) string    { return paint(colorDim, text) }

func Run() error {
	if os.Geteuid() != 0 {
		return errors.New("airdeck setup requires root; run setup through sudo, then run serve as your normal user")
	}
	const rulePath = "/etc/udev/rules.d/99-airdeck-uinput.rules"
	if !uinputModuleLoaded() {
		fmt.Println("loading the uinput kernel module")
		if err := run("modprobe", "uinput"); err != nil {
			return fmt.Errorf("load uinput module: %w", err)
		}
	}
	installed, err := installRule(rulePath)
	if err != nil {
		return err
	}
	if installed {
		fmt.Println(dim("udev rule already installed at " + rulePath))
	} else {
		fmt.Println(green("installed udev rule at " + rulePath))
		// The rule changed; reload it and reapply it to the existing node.
		fmt.Println("reloading udev rules")
		if err := run("udevadm", "control", "--reload-rules"); err != nil {
			return fmt.Errorf("reload udev rules: %w", err)
		}
		fmt.Println("applying rules to the uinput device")
		if err := run("udevadm", "trigger", "--subsystem-match=misc", "--action=change"); err != nil {
		return fmt.Errorf("trigger udev rules: %w", err)
		}
	}
	if _, err := os.Stat("/dev/uinput"); err != nil {
		return fmt.Errorf("uinput device node missing after setup: %w", err)
	}
	fmt.Println(green("done"))
	if !inInputGroup() {
		fmt.Println(yellow("add your user to the input group, then log out and back in:"))
		fmt.Println(paint("1;"+colorYellow, "    sudo usermod -aG input $USER"))
	}
	return nil
}

func uinputModuleLoaded() bool {
	_, err := os.Stat("/sys/module/uinput")
	return err == nil
}

// installRule writes the rule file only when it is missing or has changed,
// returning whether it was already present with the current content.
func installRule(path string) (alreadyInstalled bool, err error) {
	content := []byte(Rule + "\n")
	if existing, readErr := os.ReadFile(path); readErr == nil && string(existing) == string(content) {
		return true, nil
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return false, fmt.Errorf("install %s: %w", path, err)
	}
	return false, nil
}

// inInputGroup reports whether the user who invoked setup is a member of the
// input group. sudo runs setup as root, so SUDO_USER is checked first; the
// current user is the fallback for direct-root or pkexec runs.
func inInputGroup() bool {
	username := os.Getenv("SUDO_USER")
	if username == "" {
		if current, err := user.Current(); err == nil {
			username = current.Username
		} else {
			return false
		}
	}
	target, err := user.Lookup(username)
	if err != nil {
		return false
	}
	groupIDs, err := target.GroupIds()
	if err != nil {
		return false
	}
	groupIDs = append(groupIDs, target.Gid)
	for _, id := range groupIDs {
		group, err := user.LookupGroupId(id)
		if err == nil && group.Name == "input" {
			return true
		}
	}
	return false
}

var run = func(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
