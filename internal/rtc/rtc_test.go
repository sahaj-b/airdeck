package rtc

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/sahaj-b/airdeck/internal/roomcode"
)

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal %T: %v", v, err)
	}
	return data
}

func roundTrip(t *testing.T, v any) {
	t.Helper()
	data := mustMarshal(t, v)
	gotType, err := MessageType(data)
	if err != nil {
		t.Fatalf("MessageType(%T): %v", v, err)
	}
	want := reflect.ValueOf(v).FieldByName("Type").String()
	if gotType != want {
		t.Fatalf("MessageType(%T) = %q, want %q", v, gotType, want)
	}
	// Unmarshal into a fresh value of the same concrete type.
	fresh := reflect.New(reflect.TypeOf(v)).Interface()
	if err := json.Unmarshal(data, fresh); err != nil {
		t.Fatalf("unmarshal %T: %v", v, err)
	}
	if !reflect.DeepEqual(reflect.ValueOf(fresh).Elem().Interface(), v) {
		t.Fatalf("round-trip mismatch for %T:\n got %+v\nwant %+v", v, reflect.ValueOf(fresh).Elem().Interface(), v)
	}
}

func iceServers() []ICEServer {
	return []ICEServer{
		{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		{URLs: []string{"turn:turn.cloudflare.com:3478"}, Username: "user", Credential: "cred"},
	}
}

func TestMessageRoundTrip(t *testing.T) {
	cases := []any{
		Register{Type: MessageRegister, RoomCode: "ABCD22", InstallationKey: "key", ApprovalRequired: true},
		Registered{Type: MessageRegistered, RoomCode: "ABCD22", ICEServers: iceServers()},
		Conflict{Type: MessageConflict, Reason: "claimed by another installation"},
		// Phone-originated open-mode join: offer present, no relay ids.
		Join{Type: MessageJoin, RoomCode: "abcd-22", DisplayName: "Phone", ReconnectID: "r1", Offer: "v=0\r\n..."},
		// Approval-mode join: offer-less.
		Join{Type: MessageJoin, RoomCode: "ABCD22", DisplayName: "Phone"},
		// Relay-forwarded join: correlation id assigned, room code echoed or omitted.
		Join{Type: MessageJoin, PendingID: "p1", CorrelationID: "c1", DisplayName: "Phone", Offer: "v=0\r\n..."},
		Joined{Type: MessageJoined, Answer: "v=0\r\n...", ICEServers: iceServers()},
		// Host-bound pending carries the queue entry; guest-bound is bare id.
		Pending{Type: MessagePending, PendingID: "p1", DisplayName: "Phone", ReconnectID: "r1", WaitingSince: 1750000000000},
		Pending{Type: MessagePending, PendingID: "p1"},
		Accepted{Type: MessageAccepted, ICEServers: iceServers()},
		Offer{Type: MessageOffer, SDP: "v=0\r\n..."},
		Offer{Type: MessageOffer, PendingID: "p1", CorrelationID: "c2", SDP: "v=0\r\n..."},
		Answer{Type: MessageAnswer, CorrelationID: "c1", SDP: "v=0\r\n..."},
		Accept{Type: MessageAccept, PendingID: "p1"},
		Reject{Type: MessageReject, PendingID: "p1", Reason: "party is full"},
		Rejected{Type: MessageRejected, Reason: "declined by host"},
		ErrorMessage{Type: MessageError, Code: ErrorRoomNotFound, Message: "Room not found or host offline"},
		PeerLeft{Type: MessagePeerLeft, PendingID: "p1"},
	}
	for _, c := range cases {
		roundTrip(t, c)
	}
}

// Lookup and claiming normalize before comparing: case, dashes, and
// surrounding spaces never route two spellings of one code apart.
func TestNormalizationBeforeLookup(t *testing.T) {
	spellings := []string{"ABCD22", "abcd22", " ab-cd-22 ", "AB CD22", "ab-cd 22"}
	base := Join{Type: MessageJoin, RoomCode: spellings[0]}.NormalizedRoomCode()
	for _, s := range spellings[1:] {
		if got := (Join{Type: MessageJoin, RoomCode: s}).NormalizedRoomCode(); got != base {
			t.Fatalf("NormalizedRoomCode(%q) = %q, want %q", s, got, base)
		}
		if got := (Register{Type: MessageRegister, RoomCode: s}).NormalizedRoomCode(); got != base {
			t.Fatalf("register NormalizedRoomCode(%q) = %q, want %q", s, got, base)
		}
	}
	for _, s := range spellings {
		if err := roomcode.Validate(s); err != nil {
			t.Fatalf("Validate(%q): %v", s, err)
		}
	}
	// Ambiguous alphabet stays rejected: 0/O/1/I/L never validate.
	for _, bad := range []string{"ABCD20", "ABCDOI", "ABCD2L"} {
		if err := roomcode.Validate(bad); err == nil {
			t.Fatalf("Validate(%q) passed, want rejection", bad)
		}
	}
}
