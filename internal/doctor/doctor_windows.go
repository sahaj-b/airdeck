//go:build windows

package doctor

import (
	"errors"
	"os/exec"
	"runtime"
	"strings"

	"github.com/sahaj-b/airdeck/internal/vigem"
)

// probeAPI is the minimal ViGEm surface doctor needs, so tests inject a fake
// without the DLL.
type probeAPI interface {
	check() (busErr, capErr error)
}

func Run(_ bool) (Report, error) {
	return runWithProbe(vigem.CheckDLL, realProbe{})
}

func runWithProbe(checkDLL func() error, probe probeAPI) (Report, error) {
	var report Report
	report.add("architecture", runtime.GOARCH == "amd64", runtime.GOARCH, true)
	dllErr := checkDLL()
	report.add("vigem client dll", dllErr == nil, detail(dllErr, "ViGEmClient.dll loadable"), true)
	var busErr, capErr error
	if dllErr != nil {
		busErr = errors.New("skipped because dll load failed")
	} else {
		busErr, capErr = probe.check()
	}
	report.add("vigembus connection", busErr == nil, detail(busErr, "bus reachable"), true)
	capDetail := detail(capErr, "x360 pad created and destroyed")
	capOK := busErr == nil && capErr == nil
	if busErr != nil {
		capDetail = "skipped because bus probe failed"
	}
	report.add("virtual-controller capability", capOK, capDetail, true)
	fwErr := checkFirewall()
	report.add("firewall rule", fwErr == nil, detail(fwErr, "airdeck inbound rule present"), false)
	report.add("leftover devices", true, "ViGEm targets are process-bound and die with the host; none possible", false)
	if len(report.Errors) > 0 {
		return report, errors.New(strings.Join(report.Errors, "; "))
	}
	return report, nil
}

func checkFirewall() error {
	out, err := exec.Command("netsh", "advfirewall", "firewall", "show", "rule", `name="airdeck"`).CombinedOutput()
	if err != nil {
		return err
	}
	if !strings.Contains(strings.ToLower(string(out)), "airdeck") {
		return errors.New("no airdeck firewall rule found")
	}
	return nil
}
