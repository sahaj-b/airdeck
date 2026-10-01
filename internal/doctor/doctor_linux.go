//go:build linux

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

func Run(cleanup bool) (Report, error) {
	var report Report
	report.add("architecture", runtime.GOARCH == "amd64", runtime.GOARCH, true)
	_, err := os.Stat("/sys/module/uinput")
	report.add("uinput module", err == nil, detail(err, "loaded"), true)
	info, err := os.Stat("/dev/uinput")
	report.add("uinput device", err == nil, detail(err, infoMode(info)), true)
	if err == nil {
		file, openErr := os.OpenFile("/dev/uinput", os.O_RDWR, 0)
		if openErr == nil {
			file.Close()
		}
		report.add("uinput read/write access", openErr == nil, detail(openErr, "read/write access available"), true)
	} else {
		report.add("uinput read/write access", false, "device node is unavailable", true)
	}
	report.add("input group", inInputGroup(), "current user membership", true)
	if report.Errors == nil || len(report.Errors) == 0 {
		controller, probeErr := uinput.NewController(uinput.Config{Rumble: func(uint16, uint16) {}})
		if probeErr == nil {
			_ = controller.Neutralize()
			_ = controller.Destroy()
		}
		report.add("virtual-controller capability", probeErr == nil, detail(probeErr, "controller created and destroyed"), true)
	} else {
		report.add("virtual-controller capability", false, "skipped because prerequisites failed", true)
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

func infoMode(info os.FileInfo) string {
	if info == nil {
		return "missing"
	}
	return info.Mode().String()
}

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
