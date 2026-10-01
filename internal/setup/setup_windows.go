//go:build windows

package setup

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"

	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/vigem"
)

// isElevated reports whether the process runs with admin rights.
func isElevated() bool {
	dll := windows.NewLazySystemDLL("shell32.dll")
	proc := dll.NewProc("IsUserAnAdmin")
	ret, _, _ := proc.Call()
	return ret != 0
}

// elevateSelf relaunches the current exe with the same args requesting
// elevation (UAC prompt), then the parent exits.
func elevateSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := joinArgs(os.Args[1:])
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return err
	}
	params, err := windows.UTF16PtrFromString(args)
	if err != nil {
		return err
	}
	if err := windows.ShellExecute(0, verb, file, params, nil, windows.SW_SHOWNORMAL); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

// Run installs the ViGEmBus driver and the firewall rule. Unelevated runs
// relaunch elevated via UAC. Reruns are idempotent: the firewall delete
// before add prevents duplicate rules.
func Run() error {
	if !isElevated() {
		fmt.Println("requesting elevation for setup")
		return elevateSelf()
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exeDir := filepath.Dir(exe)
	installer, err := findBusInstaller(exeDir)
	if err != nil {
		return err
	}
	fmt.Println("installing ViGEmBus driver")
	if err := runCommand(installer, "/exenoui", "/qn", "/norestart"); err != nil {
		return fmt.Errorf("install vigembus: %w", err)
	}
	if err := vigem.Probe(nil); err != nil {
		return fmt.Errorf("verify bus after install: %w", err)
	}
	port := setupPort()
	// netsh add is not idempotent, so delete first, then add.
	_ = runCommand("netsh", deleteRuleArgs()...)
	if err := runCommand("netsh", addRuleArgs(exe, port)...); err != nil {
		return fmt.Errorf("add firewall rule: %w", err)
	}
	fmt.Println(green("done"))
	return nil
}

// findBusInstaller globs Drivers\ViGEmBus_*.exe beside the exe instead of
// hardcoding the release asset name.
func findBusInstaller(exeDir string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(exeDir, "Drivers", "ViGEmBus_*.exe"))
	if err != nil {
		return "", fmt.Errorf("find ViGEmBus installer: %w", err)
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no ViGEmBus installer found under %s", filepath.Join(exeDir, "Drivers"))
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("multiple ViGEmBus installers found under %s", filepath.Join(exeDir, "Drivers"))
	}
	return matches[0], nil
}

// deleteRuleArgs and addRuleArgs build the idempotent netsh sequence:
// delete-before-add because netsh add duplicates rules on reruns.
func deleteRuleArgs() []string {
	return []string{"advfirewall", "firewall", "delete", "rule", `name="airdeck"`}
}

func addRuleArgs(exe string, port int) []string {
	return []string{"advfirewall", "firewall", "add", "rule", `name="airdeck"`,
		"dir=in", "action=allow", "program=" + quotePath(exe),
		"protocol=TCP", fmt.Sprintf("localport=%d", port), "profile=any"}
}

func quotePath(path string) string {
	return `"` + path + `"`
}

func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func joinArgs(args []string) string {
	var out strings.Builder
	for i, arg := range args {
		if i > 0 {
			out.WriteByte(' ')
		}
		out.WriteString(quoteArg(arg))
	}
	return out.String()
}

func quoteArg(arg string) string {
	if arg != "" && !strings.ContainsAny(arg, " \t\n\v\"") {
		return arg
	}
	var out strings.Builder
	out.WriteByte('"')
	backslashes := 0
	for _, char := range arg {
		if char == '\\' {
			backslashes++
			continue
		}
		if char == '"' {
			out.WriteString(strings.Repeat(`\`, backslashes*2+1))
			out.WriteRune(char)
			backslashes = 0
			continue
		}
		out.WriteString(strings.Repeat(`\`, backslashes))
		out.WriteRune(char)
		backslashes = 0
	}
	out.WriteString(strings.Repeat(`\`, backslashes*2))
	out.WriteByte('"')
	return out.String()
}

// setupPort reads the configured port for the firewall rule, defaulting to
// the config default when the config is missing or invalid.
func setupPort() int {
	cfg, err := config.Load(config.File())
	if err != nil || cfg.Port == 0 {
		return config.Defaults().Port
	}
	return cfg.Port
}
