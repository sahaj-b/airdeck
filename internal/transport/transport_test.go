package transport

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/protocol"
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

func TestRumbleDuplicatesCoalesced(t *testing.T) {
	client := newClient(nil)
	start := protocol.Rumble{Type: protocol.MessageRumble, Strong: 1000, Weak: 2000, Active: true}
	if err := client.enqueue(start); err != nil {
		t.Fatal(err)
	}
	if err := client.enqueue(start); err != nil {
		t.Fatal(err)
	}
	if n := len(client.out); n != 1 {
		t.Fatalf("queued %d messages for a duplicate START, want 1", n)
	}
}

func TestRumbleStopBeatsFullQueue(t *testing.T) {
	client := newClient(nil)
	for i := 0; i < 128; i++ {
		start := protocol.Rumble{Type: protocol.MessageRumble, Strong: uint16(i + 1), Active: true}
		if err := client.enqueue(start); err != nil {
			t.Fatalf("fill %d: %v", i, err)
		}
	}
	// A repeat START may drop under pressure, but must report it.
	if err := client.enqueue(protocol.Rumble{Type: protocol.MessageRumble, Strong: 9999, Active: true}); err == nil {
		t.Fatal("expected queue-full error for START under pressure")
	}
	stop := protocol.Rumble{Type: protocol.MessageRumble, Active: false}
	if err := client.enqueue(stop); err != nil {
		t.Fatalf("STOP dropped on full queue: %v", err)
	}
	// The STOP must actually be in the queue, not just accepted.
	found := false
	for n := len(client.out); n > 0; n-- {
		message := <-client.out
		var rumble protocol.Rumble
		if json.Unmarshal(message.payload, &rumble) == nil && rumble.Type == protocol.MessageRumble && !rumble.Active {
			found = true
		}
	}
	if !found {
		t.Fatal("STOP was accepted but never queued")
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
