package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

var (
	buildOnce sync.Once
	buildErr  error
	binPath   string
)

// airdeckBinary builds the real CLI once per test run and returns its path.
func airdeckBinary(t *testing.T) string {
	t.Helper()
	buildOnce.Do(func() {
		dir, err := os.MkdirTemp("", "airdeck-bin")
		if err != nil {
			buildErr = err
			return
		}
		binPath = filepath.Join(dir, "airdeck")
		cmd := exec.Command("go", "build", "-o", binPath, "github.com/sahaj-b/airdeck/cmd")
		output, err := cmd.CombinedOutput()
		if err != nil {
			buildErr = fmt.Errorf("build airdeck: %v: %s", err, output)
		}
	})
	if buildErr != nil {
		t.Fatal(buildErr)
	}
	return binPath
}

// uinputAvailable reports whether the built binary can pass its own doctor,
// which is the same gate `serve` enforces before starting.
func uinputAvailable(t *testing.T, bin string) bool {
	t.Helper()
	cmd := exec.Command(bin, "doctor")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Logf("doctor prerequisites not met, skipping: %s", output)
		return false
	}
	if strings.Contains(string(output), "leftover airdeck device:") {
		t.Fatalf("doctor reported leftover airdeck devices before the test: %s", output)
	}
	return true
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	return port
}

func startServe(t *testing.T, bin string, port int) (*exec.Cmd, <-chan error) {
	t.Helper()
	configPath := filepath.Join(t.TempDir(), "config.json")
	cmd := exec.Command(bin, "serve", "--config", configPath, "--bind", "127.0.0.1", "--port", strconv.Itoa(port))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			<-exited
		}
	})
	return cmd, exited
}

func waitForServe(t *testing.T, cmd *exec.Cmd, exited <-chan error, port int) {
	t.Helper()
	client := &http.Client{Timeout: time.Second}
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/api/admin/state"
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-exited:
			t.Fatalf("serve exited before becoming ready: %v", err)
		default:
		}
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("serve on port %d never became ready", port)
}

func doctorOutput(t *testing.T, bin string) string {
	t.Helper()
	output, err := exec.Command(bin, "doctor").CombinedOutput()
	if err != nil {
		t.Fatalf("doctor failed: %v: %s", err, output)
	}
	return string(output)
}

func assertNoLeftovers(t *testing.T, bin string) {
	t.Helper()
	output := doctorOutput(t, bin)
	if strings.Contains(output, "leftover airdeck device:") {
		t.Fatalf("doctor reported leftover airdeck devices: %s", output)
	}
}

func assertNoLeftoversEventually(t *testing.T, bin string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		output := doctorOutput(t, bin)
		if !strings.Contains(output, "leftover airdeck device:") {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatal("airdeck-owned virtual devices remained after process exit")
}

func TestServeStopsCleanlyOnSignals(t *testing.T) {
	bin := airdeckBinary(t)
	if !uinputAvailable(t, bin) {
		t.Skip("uinput prerequisites not met")
	}
	for _, sig := range []syscall.Signal{syscall.SIGINT, syscall.SIGTERM} {
		t.Run(sig.String(), func(t *testing.T) {
			port := freePort(t)
			cmd, exited := startServe(t, bin, port)
			waitForServe(t, cmd, exited, port)
			if err := cmd.Process.Signal(sig); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-exited:
				if err != nil {
					t.Fatalf("serve exited with an error after %v: %v", sig, err)
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("serve did not exit after %v", sig)
			}
			if !cmd.ProcessState.Success() {
				t.Fatalf("serve exit status = %v after %v, want 0", cmd.ProcessState, sig)
			}
			assertNoLeftovers(t, bin)
		})
	}
}

func TestServeKill9LeavesNoDevicesAndRestarts(t *testing.T) {
	bin := airdeckBinary(t)
	if !uinputAvailable(t, bin) {
		t.Skip("uinput prerequisites not met")
	}
	port := freePort(t)
	cmd, exited := startServe(t, bin, port)
	waitForServe(t, cmd, exited, port)
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not die after SIGKILL")
	}
	// The kernel removes the uinput device when the fd closes; allow the
	// sysfs entry a short window to disappear, then prove doctor is clean.
	assertNoLeftoversEventually(t, bin, 5*time.Second)

	// A fresh serve must start cleanly after the kill.
	restartPort := freePort(t)
	restarted, restartedExited := startServe(t, bin, restartPort)
	waitForServe(t, restarted, restartedExited, restartPort)
	_ = restarted.Process.Signal(syscall.SIGTERM)
	select {
	case err := <-restartedExited:
		if err != nil {
			t.Fatalf("restarted serve exited with an error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("restarted serve did not exit after SIGTERM")
	}
}
