package transport

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestSameOriginAndLoopbackChecks(t *testing.T) {
	request := httptest.NewRequest("GET", "http://host.test/ws", nil)
	request.Host = "host.test"
	request.Header.Set("Origin", "http://host.test")
	if !SameOrigin(request) {
		t.Fatal("matching origin was rejected")
	}
	request.Header.Set("Origin", "http://other.test")
	if SameOrigin(request) {
		t.Fatal("cross-origin request was accepted")
	}
	request.Header.Del("Origin")
	if !SameOrigin(request) {
		t.Fatal("origin-less request was rejected")
	}
	if !IsLoopbackRemote("127.0.0.1:1234") || !IsLoopbackRemote("[::1]:1234") || IsLoopbackRemote("192.168.1.4:1234") {
		t.Fatal("loopback detection failed")
	}
}

func TestClientPingStateIsBounded(t *testing.T) {
	client := newClient(nil)
	for i := 0; i < maxPendingPings+4; i++ {
		client.trackPing(string(rune(i)), time.Unix(int64(i), 0))
	}
	client.pingMu.Lock()
	count := len(client.pending)
	client.pingMu.Unlock()
	if count != maxPendingPings {
		t.Fatalf("pending ping count = %d, want %d", count, maxPendingPings)
	}
	if _, ok := client.takePing(string(rune(0))); ok {
		t.Fatal("oldest ping was not evicted")
	}
}
