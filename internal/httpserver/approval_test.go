package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/session"
)

// loopbackRequest builds a loopback admin request against the test server.
func loopbackRequest(method, path, body string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.RemoteAddr = "127.0.0.1:4321"
	return req
}

func decodeState(t *testing.T, rec *httptest.ResponseRecorder) adminState {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var state adminState
	if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
		t.Fatalf("decode admin state: %v", err)
	}
	return state
}

// TestApprovalTogglePersists flips approvalRequired through the settings
// endpoint: the session gate and persisted config move together.
func TestApprovalTogglePersists(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if sess.ApprovalRequired() {
		t.Fatal("approval defaults on, want off")
	}

	req := loopbackRequest(http.MethodPut, "/api/admin/settings", `{"approvalRequired":true}`)
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state := decodeState(t, rec)
	if !state.Config.ApprovalRequired || !sess.ApprovalRequired() {
		t.Fatalf("approval not enabled: config=%v session=%v",
			state.Config.ApprovalRequired, sess.ApprovalRequired())
	}

	req = loopbackRequest(http.MethodPut, "/api/admin/settings", `{"approvalRequired":false}`)
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state = decodeState(t, rec)
	if state.Config.ApprovalRequired || sess.ApprovalRequired() {
		t.Fatalf("approval not disabled: config=%v session=%v",
			state.Config.ApprovalRequired, sess.ApprovalRequired())
	}
}

// TestApprovalQueueAcceptReject walks one LAN pending through the dashboard
// routes: queued in state, accepted to a player, or rejected away.
func TestApprovalQueueAcceptReject(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	sess.SetApprovalRequired(true)

	admission, err := sess.Admit(sess.Code(), "Phone", "", "", nil, nil)
	if err == nil || admission.PendingID == "" {
		t.Fatalf("Admit = %+v, err = %v, want pending", admission, err)
	}
	pendingID := admission.PendingID

	// Queued in state with an empty players list.
	req := loopbackRequest(http.MethodGet, "/api/admin/state", "")
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state := decodeState(t, rec)
	if len(state.Pendings) != 1 || state.Pendings[0].ID != pendingID {
		t.Fatalf("pendings = %+v, want [%s]", state.Pendings, pendingID)
	}
	if len(state.Players) != 0 {
		t.Fatalf("players = %d before accept, want 0", len(state.Players))
	}

	// Accept promotes to a player and drains the queue.
	req = loopbackRequest(http.MethodPost, "/api/admin/approval/"+pendingID+"/accept", "")
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state = decodeState(t, rec)
	if len(state.Pendings) != 0 {
		t.Fatalf("pendings = %d after accept, want 0", len(state.Pendings))
	}
	if len(state.Players) != 1 || state.Players[0].Name != "Phone" {
		t.Fatalf("players = %+v after accept", state.Players)
	}

	// Second pending rejects cleanly.
	admission, err = sess.Admit(sess.Code(), "Guest", "", "", nil, nil)
	if err == nil || admission.PendingID == "" {
		t.Fatalf("second Admit = %+v, err = %v, want pending", admission, err)
	}
	req = loopbackRequest(http.MethodPost, "/api/admin/approval/"+admission.PendingID+"/reject", `{"reason":"party is full"}`)
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state = decodeState(t, rec)
	if len(state.Pendings) != 0 || len(state.Players) != 1 {
		t.Fatalf("after reject pendings=%d players=%d", len(state.Pendings), len(state.Players))
	}

	// Unknown ids 404 instead of minting players.
	req = loopbackRequest(http.MethodPost, "/api/admin/approval/nope/accept", "")
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown accept status = %d, want 404", rec.Code)
	}
}

// TestApprovalAcceptFullKeepsQueued fills every slot, then proves an accept
// on a full session reports 409 and keeps the pending queued for retry.
func TestApprovalAcceptFullKeepsQueued(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	sess.SetApprovalRequired(false)
	for i := 0; i < session.MaxPlayers-1; i++ {
		if _, err := sess.Admit(sess.Code(), "P", "", "", nil, nil); err != nil {
			t.Fatalf("fill slot %d: %v", i, err)
		}
	}
	sess.SetApprovalRequired(true)
	queued, err := sess.Admit(sess.Code(), "Late", "", "", nil, nil)
	if err == nil || queued.PendingID == "" {
		t.Fatalf("queue Admit = %+v, err = %v, want pending", queued, err)
	}
	// Fill the last slot before the host accepts: the accept must fail
	// full and keep the pending queued for retry.
	sess.SetApprovalRequired(false)
	if _, err := sess.Admit(sess.Code(), "Last", "", "", nil, nil); err != nil {
		t.Fatalf("fill last slot: %v", err)
	}
	sess.SetApprovalRequired(true)

	req := loopbackRequest(http.MethodPost, "/api/admin/approval/"+queued.PendingID+"/accept", "")
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("full accept status = %d, want 409", rec.Code)
	}
	if pendings := sess.Pendings(); len(pendings) != 1 {
		t.Fatalf("pendings = %d after full accept, want 1 kept", len(pendings))
	}
}

// TestRoomCodeGenerateAndSet covers the conflict-banner resolve path:
// generate mints a fresh valid code, custom set installs it, invalid
// input is rejected, and the session follows both.
func TestRoomCodeGenerateAndSet(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	before := sess.Code()

	req := loopbackRequest(http.MethodPost, "/api/admin/room-code/generate", "")
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state := decodeState(t, rec)
	if state.Code == "" || state.Code == before {
		t.Fatalf("generated code = %q (was %q), want fresh", state.Code, before)
	}
	if err := roomcode.Validate(state.Code); err != nil {
		t.Fatalf("generated code invalid: %v", err)
	}
	if sess.Code() != state.Code || state.Config.RoomCode != state.Code {
		t.Fatalf("session=%q config=%q state=%q diverged", sess.Code(), state.Config.RoomCode, state.Code)
	}

	req = loopbackRequest(http.MethodPut, "/api/admin/room-code", `{"roomCode":"desk-2222"}`)
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state = decodeState(t, rec)
	if state.Code != "DESK2222" || sess.Code() != "DESK2222" {
		t.Fatalf("custom code state=%q session=%q, want DESK2222", state.Code, sess.Code())
	}

	req = loopbackRequest(http.MethodPut, "/api/admin/room-code", `{"roomCode":"bad!!"}`)
	rec = httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid code status = %d, want 400", rec.Code)
	}
	if sess.Code() != "DESK2222" {
		t.Fatalf("session code moved on invalid input: %q", sess.Code())
	}
}

// TestAdminStatePendingsNeverNull guards the dashboard queue: an empty
// queue serializes as [] so the UI never sees undefined.
func TestAdminStatePendingsNeverNull(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	req := loopbackRequest(http.MethodGet, "/api/admin/state", "")
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"pendings":[]`) {
		t.Fatalf("state body lacks empty pendings array: %s", rec.Body.String())
	}
	state := decodeState(t, rec)
	if state.Pendings == nil || len(state.Pendings) != 0 {
		t.Fatalf("pendings = %+v, want empty non-nil", state.Pendings)
	}
}

// TestPlayerRelayedDefaultsFalse pins the new badge field: LAN players
// report unknown (never direct) until a PeerManager observes a pair.
func TestPlayerRelayedDefaultsFalse(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if _, err := sess.Admit(sess.Code(), "Phone", "", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	req := loopbackRequest(http.MethodGet, "/api/admin/state", "")
	rec := httptest.NewRecorder()
	server.routes(false).ServeHTTP(rec, req)
	state := decodeState(t, rec)
	if len(state.Players) != 1 {
		t.Fatalf("players = %d, want 1", len(state.Players))
	}
	if state.Players[0].Relayed {
		t.Fatal("LAN player reports relayed, want not relayed")
	}
	if state.Players[0].RelayState != "unknown" {
		t.Fatalf("LAN player relayState = %q, want unknown", state.Players[0].RelayState)
	}
}

// stubAgent implements the relay half of pendingJoins: one queued relay
// pending backing a session row, so the merge hides the session id.
type stubAgent struct {
	relayID   string
	sessionID string
	display   string
}

func (s *stubAgent) Pendings() []session.PendingSnapshot {
	return []session.PendingSnapshot{{ID: s.relayID, DisplayName: s.display}}
}

func (s *stubAgent) OwnsSessionPending(id string) bool {
	return id == s.sessionID
}

// TestPendingJoinsHidesBackingSessionRow proves one relay guest appears
// once under its relay id, while pure LAN pendings keep session ids.
func TestPendingJoinsHidesBackingSessionRow(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	sess.SetApprovalRequired(true)
	relayBacked, err := sess.Admit(sess.Code(), "Relay", "", "", nil, nil)
	if err == nil || relayBacked.PendingID == "" {
		t.Fatalf("relay-backed Admit = %+v, err = %v", relayBacked, err)
	}
	lanOnly, err := sess.Admit(sess.Code(), "Lan", "", "", nil, nil)
	if err == nil || lanOnly.PendingID == "" {
		t.Fatalf("lan Admit = %+v, err = %v", lanOnly, err)
	}

	stub := &stubAgent{relayID: "relay-1", sessionID: relayBacked.PendingID, display: "Relay"}
	merged := server.pendingJoins(stub)
	if len(merged) != 2 {
		t.Fatalf("merged = %+v, want 2 rows", merged)
	}
	ids := map[string]bool{merged[0].ID: true, merged[1].ID: true}
	if !ids["relay-1"] || !ids[lanOnly.PendingID] {
		t.Fatalf("merged ids = %v, want relay-1 plus %s", ids, lanOnly.PendingID)
	}
	if ids[relayBacked.PendingID] {
		t.Fatalf("backing session id %s leaked alongside relay-1", relayBacked.PendingID)
	}
}
