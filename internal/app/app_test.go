package app

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/config"
)

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

func waitForHTTP(t *testing.T, url string) {
	t.Helper()
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("HTTP server at %s never became ready", url)
}

func TestRunStopsOnContextCancellationAndClosesListeners(t *testing.T) {
	cfg := config.Defaults()
	cfg.Bind = "127.0.0.1"
	cfg.Port = freePort(t)
	application, err := New(cfg, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- application.Run(ctx) }()
	stateURL := "http://127.0.0.1:" + strconv.Itoa(cfg.Port) + "/api/admin/state"
	waitForHTTP(t, stateURL)
	if !application.Session.AcceptingJoins() {
		t.Fatal("session is not accepting joins at start")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned an error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop after context cancellation")
	}
	if application.Session.AcceptingJoins() {
		t.Fatal("session still accepting joins after shutdown")
	}
	host := strings.TrimPrefix(stateURL, "http://")
	conn, err := net.DialTimeout("tcp", host, time.Second)
	if err == nil {
		conn.Close()
		t.Fatal("listener still accepting connections after shutdown")
	}
}
