package doctor

import (
	"errors"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

type Check struct {
	Name     string `json:"name"`
	OK       bool   `json:"ok"`
	Detail   string `json:"detail"`
	Critical bool   `json:"critical"`
}

type Report struct {
	Checks    []Check  `json:"checks"`
	Errors    []string `json:"errors"`
	Leftovers []string `json:"leftovers"`
}

func Run(cleanup bool) (Report, error) {
	var report Report
	add := func(name string, ok bool, detail string, critical bool) {
		report.Checks = append(report.Checks, Check{Name: name, OK: ok, Detail: detail, Critical: critical})
		if critical && !ok {
			report.Errors = append(report.Errors, name+": "+detail)
		}
	}
	add("architecture", runtime.GOARCH == "amd64", runtime.GOARCH, true)
	_, err := os.Stat("/sys/module/uinput")
	add("uinput module", err == nil, detail(err, "loaded"), true)
	info, err := os.Stat("/dev/uinput")
	add("uinput device", err == nil, detail(err, infoMode(info)), true)
	if err == nil {
		file, openErr := os.OpenFile("/dev/uinput", os.O_RDWR, 0)
		if openErr == nil {
			file.Close()
		}
		add("uinput read/write access", openErr == nil, detail(openErr, "read/write access available"), true)
	} else {
		add("uinput read/write access", false, "device node is unavailable", true)
	}
	add("input group", inInputGroup(), "current user membership", true)
	if report.Errors == nil || len(report.Errors) == 0 {
		controller, probeErr := uinput.NewController(uinput.Config{Rumble: func(uint16, uint16) {}})
		if probeErr == nil {
			_ = controller.Neutralize()
			_ = controller.Destroy()
		}
		add("virtual-controller capability", probeErr == nil, detail(probeErr, "controller created and destroyed"), true)
	} else {
		add("virtual-controller capability", false, "skipped because prerequisites failed", true)
	}
	report.Leftovers = findLeftovers()
	if cleanup && len(report.Leftovers) > 0 {
		return report, errors.New("cleanup is limited to devices owned by a live process; stop that process and rerun doctor")
	}
	if len(report.Errors) > 0 {
		return report, errors.New(strings.Join(report.Errors, "; "))
	}
	return report, nil
}

func detail(err error, success string) string {
	if err == nil {
		return success
	}
	return err.Error()
}

func infoMode(info os.FileInfo) string {
	if info == nil {
		return "missing"
	}
	return info.Mode().String()
}

func inInputGroup() bool {
	current, err := user.Current()
	if err != nil {
		return false
	}
	groups, err := current.GroupIds()
	if err != nil {
		return false
	}
	for _, id := range groups {
		group, err := user.LookupGroupId(id)
		if err == nil && group.Name == "input" {
			return true
		}
	}
	return false
}

func findLeftovers() []string {
	entries, err := os.ReadDir("/sys/class/input")
	if err != nil {
		return nil
	}
	var leftovers []string
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "input") {
			continue
		}
		root := filepath.Join("/sys/class/input", entry.Name())
		// Airdeck devices are created through uinput and always live under
		// /sys/devices/virtual. A real Xbox 360 pad shares the vendor/product
		// IDs but resolves into the physical device tree, so it is not ours.
		resolved, err := filepath.EvalSymlinks(root)
		if err != nil || !strings.Contains(resolved, "/devices/virtual/") {
			continue
		}
		name, _ := os.ReadFile(filepath.Join(root, "name"))
		vendor, _ := os.ReadFile(filepath.Join(root, "id", "vendor"))
		product, _ := os.ReadFile(filepath.Join(root, "id", "product"))
		if strings.TrimSpace(string(name)) == "Xbox 360 Controller" && strings.EqualFold(strings.TrimSpace(string(vendor)), "045e") && strings.EqualFold(strings.TrimSpace(string(product)), "028e") {
			leftovers = append(leftovers, root)
		}
	}
	return leftovers
}
