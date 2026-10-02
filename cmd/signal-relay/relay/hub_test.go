package relay

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/rtc"
)

func testRelay(t *testing.T, enforce, allowLocalhost bool) (*Hub, string) {
	t.Helper()
	hub := NewHub(openTestStore(t), nil, enforce)
	server := httptest.NewServer(NewServer(hub, allowLocalhost).Routes())
	t.Cleanup(server.Close)
	return hub, "ws" + strings.TrimPrefix(server.URL, "http")
}

func dialRelay(t *testing.T, url, origin string) *websocket.Conn {
	t.Helper()
	header := http.Header{}
	if origin != "" {
		header.Set("Origin", origin)
	}
	conn, resp, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		if resp != nil {
			_ = resp.Body.Close()
		}
		t.Fatalf("dial %s (origin %q): %v", url, origin, err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func readFrame(t *testing.T, conn *websocket.Conn) (string, []byte) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read message: %v", err)
	}
	msgType, err := rtc.MessageType(data)
	if err != nil {
		t.Fatalf("message type: %v", err)
	}
	return msgType, data
}

func mustWrite(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := conn.WriteJSON(value); err != nil {
		t.Fatalf("write %T: %v", value, err)
	}
}

func registerHost(t *testing.T, base, code, key string, approval bool) *websocket.Conn {
	t.Helper()
	conn := dialRelay(t, base+"/register", "")
	mustWrite(t, conn, rtc.Register{
		Type: rtc.MessageRegister, RoomCode: code,
		InstallationKey: key, ApprovalRequired: approval,
	})
	msgType, data := readFrame(t, conn)
	if msgType != rtc.MessageRegistered {
		t.Fatalf("register reply type = %q, want registered (body %s)", msgType, data)
	}
	var registered rtc.Registered
	if err := json.Unmarshal(data, &registered); err != nil {
		t.Fatalf("decode registered: %v", err)
	}
	if registered.RoomCode != code {
		t.Fatalf("registered code = %q, want %q", registered.RoomCode, code)
	}
	if len(registered.ICEServers) == 0 {
		t.Fatal("registered carries no iceServers")
	}
	return conn
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestHealth(t *testing.T) {
	hub := NewHub(openTestStore(t), nil, false)
	server := httptest.NewServer(NewServer(hub, false).Routes())
	defer server.Close()
	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d, want 200", resp.StatusCode)
	}
	var body map[string]bool
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || !body["ok"] {
		t.Fatalf("health body = %+v, %v; want {ok:true}", body, err)
	}
}

// Open mode: join carries the offer, the host answer correlates by the
// relay-assigned id, and the guest gets joined with fresh iceServers.
func TestOpenModeJoinAnswer(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "GATE22", "key-a", false)
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{
		Type: rtc.MessageJoin, RoomCode: " gate-22 ", DisplayName: "Phone", Offer: "offer-sdp",
	})
	msgType, data := readFrame(t, host)
	if msgType != rtc.MessageJoin {
		t.Fatalf("host got %q, want join", msgType)
	}
	var forwarded rtc.Join
	if err := json.Unmarshal(data, &forwarded); err != nil {
		t.Fatalf("decode forwarded join: %v", err)
	}
	if forwarded.CorrelationID == "" || forwarded.Offer != "offer-sdp" || forwarded.DisplayName != "Phone" {
		t.Fatalf("forwarded join = %+v, want correlation id plus offer", forwarded)
	}
	mustWrite(t, host, rtc.Answer{
		Type: rtc.MessageAnswer, CorrelationID: forwarded.CorrelationID, SDP: "answer-sdp",
	})
	msgType, data = readFrame(t, guest)
	if msgType != rtc.MessageJoined {
		t.Fatalf("guest got %q, want joined", msgType)
	}
	var joined rtc.Joined
	if err := json.Unmarshal(data, &joined); err != nil {
		t.Fatalf("decode joined: %v", err)
	}
	if joined.Answer != "answer-sdp" || len(joined.ICEServers) == 0 {
		t.Fatalf("joined = %+v, want answer plus iceServers", joined)
	}
}

// Approval mode: offer-less join parks as pending, accept releases TURN
// creds, the post-accept offer correlates, and the answer forwards as-is.
func TestApprovalAcceptOfferAnswer(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "APRV22", "key-a", true)
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "APRV22", DisplayName: "Phone"})
	msgType, data := readFrame(t, guest)
	if msgType != rtc.MessagePending {
		t.Fatalf("guest got %q, want pending", msgType)
	}
	var guestPending rtc.Pending
	if err := json.Unmarshal(data, &guestPending); err != nil || guestPending.PendingID == "" {
		t.Fatalf("guest pending = %s, want bare id", data)
	}
	msgType, data = readFrame(t, host)
	if msgType != rtc.MessagePending {
		t.Fatalf("host got %q, want pending", msgType)
	}
	var hostPending rtc.Pending
	if err := json.Unmarshal(data, &hostPending); err != nil {
		t.Fatalf("decode host pending: %v", err)
	}
	if hostPending.PendingID != guestPending.PendingID || hostPending.DisplayName != "Phone" || hostPending.WaitingSince == 0 {
		t.Fatalf("host pending = %+v, want full queue entry", hostPending)
	}
	mustWrite(t, host, rtc.Accept{Type: rtc.MessageAccept, PendingID: hostPending.PendingID})
	msgType, data = readFrame(t, guest)
	if msgType != rtc.MessageAccepted {
		t.Fatalf("guest got %q, want accepted", msgType)
	}
	var accepted rtc.Accepted
	if err := json.Unmarshal(data, &accepted); err != nil || len(accepted.ICEServers) == 0 {
		t.Fatalf("accepted = %s, want iceServers", data)
	}
	mustWrite(t, guest, rtc.Offer{Type: rtc.MessageOffer, SDP: "post-accept-offer"})
	msgType, data = readFrame(t, host)
	if msgType != rtc.MessageOffer {
		t.Fatalf("host got %q, want offer", msgType)
	}
	var forwarded rtc.Offer
	if err := json.Unmarshal(data, &forwarded); err != nil {
		t.Fatalf("decode forwarded offer: %v", err)
	}
	if forwarded.PendingID != hostPending.PendingID || forwarded.CorrelationID == "" || forwarded.SDP != "post-accept-offer" {
		t.Fatalf("forwarded offer = %+v", forwarded)
	}
	mustWrite(t, host, rtc.Answer{
		Type: rtc.MessageAnswer, CorrelationID: forwarded.CorrelationID, SDP: "final-answer",
	})
	msgType, data = readFrame(t, guest)
	if msgType != rtc.MessageAnswer {
		t.Fatalf("guest got %q, want answer", msgType)
	}
	var answer rtc.Answer
	if err := json.Unmarshal(data, &answer); err != nil {
		t.Fatalf("decode answer: %v", err)
	}
	if answer.CorrelationID != forwarded.CorrelationID || answer.SDP != "final-answer" {
		t.Fatalf("answer = %+v", answer)
	}
}

// Reject returns the guest to the join screen; the same socket may
// immediately re-request a fresh pending.
func TestApprovalRejectThenReRequest(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "RJCT22", "key-a", true)
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "RJCT22", DisplayName: "Phone"})
	_, data := readFrame(t, guest)
	var first rtc.Pending
	if err := json.Unmarshal(data, &first); err != nil {
		t.Fatalf("decode pending: %v", err)
	}
	_, _ = readFrame(t, host)
	mustWrite(t, host, rtc.Reject{Type: rtc.MessageReject, PendingID: first.PendingID, Reason: "party is full"})
	msgType, data := readFrame(t, guest)
	if msgType != rtc.MessageRejected {
		t.Fatalf("guest got %q, want rejected", msgType)
	}
	var rejected rtc.Rejected
	if err := json.Unmarshal(data, &rejected); err != nil || rejected.Reason != "party is full" {
		t.Fatalf("rejected = %s", data)
	}
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "RJCT22", DisplayName: "Phone"})
	msgType, data = readFrame(t, guest)
	if msgType != rtc.MessagePending {
		t.Fatalf("re-request got %q, want pending", msgType)
	}
	var second rtc.Pending
	if err := json.Unmarshal(data, &second); err != nil || second.PendingID == "" || second.PendingID == first.PendingID {
		t.Fatalf("re-request pending = %s, want a fresh id", data)
	}
	msgType, _ = readFrame(t, host)
	if msgType != rtc.MessagePending {
		t.Fatalf("host got %q for re-request, want pending", msgType)
	}
}

// A guest that disconnects evaporates its pending: the host's accept is
// a no-op pending_gone, and the dashboard reconciles via admin state.
func TestGuestDisconnectEvaporatesPending(t *testing.T) {
	hub, base := testRelay(t, false, false)
	host := registerHost(t, base, "EVAP22", "key-a", true)
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "EVAP22", DisplayName: "Phone"})
	_, data := readFrame(t, guest)
	var pending rtc.Pending
	if err := json.Unmarshal(data, &pending); err != nil {
		t.Fatalf("decode pending: %v", err)
	}
	_, _ = readFrame(t, host)
	_ = guest.Close()
	waitFor(t, "pending to evaporate", func() bool {
		hub.mu.Lock()
		defer hub.mu.Unlock()
		return len(hub.pendings) == 0
	})
	mustWrite(t, host, rtc.Accept{Type: rtc.MessageAccept, PendingID: pending.PendingID})
	msgType, data := readFrame(t, host)
	if msgType != rtc.MessageError {
		t.Fatalf("host got %q, want error pending_gone", msgType)
	}
	var errMsg rtc.ErrorMessage
	if err := json.Unmarshal(data, &errMsg); err != nil || errMsg.Code != rtc.ErrorPendingGone {
		t.Fatalf("error = %s, want pending_gone", data)
	}
}

// Unknown, retired, and offline-host codes return byte-identical errors:
// one relay path, no enumeration oracle.
func TestDeadCodeErrorsIdentical(t *testing.T) {
	hub, base := testRelay(t, false, false)
	_ = registerHost(t, base, "ARCH22", "key-a", false)
	changer := dialRelay(t, base+"/register", "")
	mustWrite(t, changer, rtc.Register{Type: rtc.MessageRegister, RoomCode: "NEW222", InstallationKey: "key-a"})
	_, _ = readFrame(t, changer)
	offline := registerHost(t, base, "DARK22", "key-b", false)
	_ = offline.Close()
	waitFor(t, "offline host to drop", func() bool {
		hub.mu.Lock()
		defer hub.mu.Unlock()
		_, ok := hub.hosts["DARK22"]
		return !ok
	})
	guest := dialRelay(t, base+"/join", "")
	var bodies [][]byte
	for _, code := range []string{"ZAPPY2", "ARCH22", "DARK22"} {
		mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: code, Offer: "offer-sdp"})
		msgType, data := readFrame(t, guest)
		if msgType != rtc.MessageError {
			t.Fatalf("code %s got %q, want error", code, msgType)
		}
		bodies = append(bodies, data)
		var errMsg rtc.ErrorMessage
		if err := json.Unmarshal(data, &errMsg); err != nil || errMsg.Code != rtc.ErrorRoomNotFound {
			t.Fatalf("code %s error = %s, want room_not_found", code, data)
		}
	}
	if !bytes.Equal(bodies[0], bodies[1]) || !bytes.Equal(bodies[1], bodies[2]) {
		t.Fatalf("dead-code errors differ:\nunknown=%s\nretired=%s\noffline=%s", bodies[0], bodies[1], bodies[2])
	}
}

// Two open-mode guests: answers route by correlation id, never by
// connection, so each phone gets its own SDP.
func TestCorrelationRoutesToCorrectGuest(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "MATCH22", "key-a", false)
	guestA := dialRelay(t, base+"/join", "")
	guestB := dialRelay(t, base+"/join", "")
	mustWrite(t, guestA, rtc.Join{Type: rtc.MessageJoin, RoomCode: "MATCH22", Offer: "offer-a"})
	mustWrite(t, guestB, rtc.Join{Type: rtc.MessageJoin, RoomCode: "MATCH22", Offer: "offer-b"})
	forwards := make(map[string]string)
	for i := 0; i < 2; i++ {
		msgType, data := readFrame(t, host)
		if msgType != rtc.MessageJoin {
			t.Fatalf("host got %q, want join", msgType)
		}
		var join rtc.Join
		if err := json.Unmarshal(data, &join); err != nil {
			t.Fatalf("decode join: %v", err)
		}
		forwards[join.Offer] = join.CorrelationID
	}
	if forwards["offer-a"] == "" || forwards["offer-b"] == "" || forwards["offer-a"] == forwards["offer-b"] {
		t.Fatalf("correlation ids not distinct per flow: %+v", forwards)
	}
	mustWrite(t, host, rtc.Answer{Type: rtc.MessageAnswer, CorrelationID: forwards["offer-b"], SDP: "answer-b"})
	mustWrite(t, host, rtc.Answer{Type: rtc.MessageAnswer, CorrelationID: forwards["offer-a"], SDP: "answer-a"})
	_, data := readFrame(t, guestB)
	var joinedB rtc.Joined
	if err := json.Unmarshal(data, &joinedB); err != nil || joinedB.Answer != "answer-b" {
		t.Fatalf("guest B joined = %s, want answer-b", data)
	}
	_, data = readFrame(t, guestA)
	var joinedA rtc.Joined
	if err := json.Unmarshal(data, &joinedA); err != nil || joinedA.Answer != "answer-a" {
		t.Fatalf("guest A joined = %s, want answer-a", data)
	}
}

func TestSecondInstallationConflicts(t *testing.T) {
	_, base := testRelay(t, false, false)
	_ = registerHost(t, base, "BUSY22", "key-a", false)
	squatter := dialRelay(t, base+"/register", "")
	mustWrite(t, squatter, rtc.Register{Type: rtc.MessageRegister, RoomCode: "BUSY22", InstallationKey: "key-b"})
	msgType, data := readFrame(t, squatter)
	if msgType != rtc.MessageConflict {
		t.Fatalf("squatter got %q, want conflict", msgType)
	}
	var conflict rtc.Conflict
	if err := json.Unmarshal(data, &conflict); err != nil || conflict.Reason == "" {
		t.Fatalf("conflict = %s", data)
	}
}

func TestSameKeyReRegister(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "SAME22", "key-a", false)
	mustWrite(t, host, rtc.Register{Type: rtc.MessageRegister, RoomCode: "same22", InstallationKey: "key-a"})
	msgType, data := readFrame(t, host)
	if msgType != rtc.MessageRegistered {
		t.Fatalf("re-register got %q, want registered", msgType)
	}
	var registered rtc.Registered
	if err := json.Unmarshal(data, &registered); err != nil || registered.RoomCode != "SAME22" {
		t.Fatalf("re-register = %s, want normalized SAME22", data)
	}
}

// A dashboard code change on the same socket tombstones the old code:
// the old room goes dark while the new one routes.
func TestCodeChangeTombstonesOld(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "PREV22", "key-a", false)
	mustWrite(t, host, rtc.Register{Type: rtc.MessageRegister, RoomCode: "NEXT22", InstallationKey: "key-a"})
	msgType, _ := readFrame(t, host)
	if msgType != rtc.MessageRegistered {
		t.Fatalf("code change got %q, want registered", msgType)
	}
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "PREV22", Offer: "offer-sdp"})
	if msgType, _ := readFrame(t, guest); msgType != rtc.MessageError {
		t.Fatalf("old code got %q, want error", msgType)
	}
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "NEXT22", Offer: "offer-sdp"})
	if msgType, _ := readFrame(t, host); msgType != rtc.MessageJoin {
		t.Fatalf("new code got %q on host, want join", msgType)
	}
}

func TestGuestOriginAllowlist(t *testing.T) {
	_, strict := testRelay(t, false, false)
	evil, resp, err := websocket.DefaultDialer.Dial(strict+"/join", http.Header{"Origin": {"https://evil.example"}})
	if err == nil {
		_ = evil.Close()
		t.Fatal("evil origin was accepted")
	}
	if resp != nil {
		_ = resp.Body.Close()
	}
	prod := dialRelay(t, strict+"/join", "https://airdeck.sahaj.dev")
	_ = prod.Close()
	empty := dialRelay(t, strict+"/join", "")
	_ = empty.Close()

	_, dev := testRelay(t, false, true)
	if _, _, err := websocket.DefaultDialer.Dial(dev+"/join", http.Header{"Origin": {"https://evil.example"}}); err == nil {
		t.Fatal("dev server accepted an evil origin")
	}
	local := dialRelay(t, dev+"/join", "http://localhost:5173")
	_ = local.Close()
	loopback := dialRelay(t, dev+"/join", "http://127.0.0.1:8080")
	_ = loopback.Close()
}

func TestGuestExtraOrigins(t *testing.T) {
	hub := NewHub(openTestStore(t), nil, false)
	// Trailing slash is normalized away; garbage entries are dropped.
	server := httptest.NewServer(
		NewServer(hub, false, "https://preview.pages.dev/", "not-an-origin").Routes(),
	)
	defer server.Close()
	base := "ws" + strings.TrimPrefix(server.URL, "http")

	preview := dialRelay(t, base+"/join", "https://preview.pages.dev")
	_ = preview.Close()

	evil, resp, err := websocket.DefaultDialer.Dial(
		base+"/join",
		http.Header{"Origin": {"https://evil.example"}},
	)
	if err == nil {
		_ = evil.Close()
		t.Fatal("evil origin was accepted despite extras")
	}
	if resp != nil {
		_ = resp.Body.Close()
	}
}

// A host that drops before signaling completes ends its pendings with
// peer.left, the only post-pending relay-to-guest message.
func TestHostDropSendsPeerLeft(t *testing.T) {
	_, base := testRelay(t, false, false)
	host := registerHost(t, base, "AWAY22", "key-a", true)
	guest := dialRelay(t, base+"/join", "")
	mustWrite(t, guest, rtc.Join{Type: rtc.MessageJoin, RoomCode: "AWAY22", DisplayName: "Phone"})
	_, data := readFrame(t, guest)
	var pending rtc.Pending
	if err := json.Unmarshal(data, &pending); err != nil {
		t.Fatalf("decode pending: %v", err)
	}
	_, _ = readFrame(t, host)
	_ = host.Close()
	msgType, data := readFrame(t, guest)
	if msgType != rtc.MessagePeerLeft {
		t.Fatalf("guest got %q, want peer.left", msgType)
	}
	var left rtc.PeerLeft
	if err := json.Unmarshal(data, &left); err != nil || left.PendingID != pending.PendingID {
		t.Fatalf("peer.left = %s", data)
	}
}

func TestRegistrationRateLimitToggle(t *testing.T) {
	strict := NewHub(openTestStore(t), nil, true)
	strict.registerLimits = NewRateLimiter(1, 24*time.Hour)
	server := httptest.NewServer(NewServer(strict, false).Routes())
	defer server.Close()
	base := "ws" + strings.TrimPrefix(server.URL, "http")
	_ = registerHost(t, base, "UNA222", "key-a", false)
	second := dialRelay(t, base+"/register", "")
	mustWrite(t, second, rtc.Register{Type: rtc.MessageRegister, RoomCode: "DUET22", InstallationKey: "key-c"})
	if msgType, _ := readFrame(t, second); msgType != rtc.MessageConflict {
		t.Fatalf("over-limit register got %q, want conflict", msgType)
	}

	lax := NewHub(openTestStore(t), nil, false)
	lax.registerLimits = NewRateLimiter(1, 24*time.Hour)
	laxServer := httptest.NewServer(NewServer(lax, false).Routes())
	defer laxServer.Close()
	laxBase := "ws" + strings.TrimPrefix(laxServer.URL, "http")
	_ = registerHost(t, laxBase, "UNA222", "key-a", false)
	_ = registerHost(t, laxBase, "DUET22", "key-c", false)
}
