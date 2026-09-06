package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
)

func TestPendingStoreClaimSerializesDecisions(t *testing.T) {
	store := newPendingStore(nil)
	entry, err := store.Create("phone", "Player", layout.Document{ID: "layout"})
	if err != nil {
		t.Fatal(err)
	}

	claimed, err := store.Claim(entry.ID)
	if err != nil || claimed != entry {
		t.Fatalf("claim = %p, %v; want %p", claimed, err, entry)
	}
	if _, err := store.Claim(entry.ID); !errors.Is(err, errPendingBusy) {
		t.Fatalf("second claim error = %v, want busy", err)
	}
	if _, err := store.Remove(entry.ID); !errors.Is(err, errPendingBusy) {
		t.Fatalf("remove during claim error = %v, want busy", err)
	}
	store.expire(&pendingEntry{ID: entry.ID})
	if _, err := store.Claim(entry.ID); !errors.Is(err, errPendingBusy) {
		t.Fatalf("stale expiry removed claim error = %v, want busy", err)
	}

	store.Release(entry.ID, entry)
	removed, err := store.Remove(entry.ID)
	if err != nil || removed != entry {
		t.Fatalf("remove after release = %p, %v; want %p", removed, err, entry)
	}
}

func TestLayoutCRUDLoopback(t *testing.T) {
	server, _, sess := newTestHTTPServerWithUserDir(t, "127.0.0.1", t.TempDir())
	defer sess.Close()
	handler := server.routes(false)

	// Create
	doc := layout.Document{
		ID: "my-edit", Name: "My edit", SchemaVersion: 1,
		Sections: []layout.Section{
			{ID: "left", RelativeWidth: 0.86, Controls: []layout.Control{}},
			{ID: "center", RelativeWidth: 0.5, Controls: []layout.Control{}},
			{ID: "right", RelativeWidth: 0.94, Controls: []layout.Control{}},
		},
	}
	data, _ := json.Marshal(doc)
	req := httptest.NewRequest(http.MethodPost, "/api/admin/layouts", bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:1234"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body %s", rec.Code, rec.Body.String())
	}
	// Get
	req = httptest.NewRequest(http.MethodGet, "/api/admin/layouts/my-edit", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, body %s", rec.Code, rec.Body.String())
	}
	var got layout.Document
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != "my-edit" {
		t.Fatalf("got id %q", got.ID)
	}
	// Update
	doc.Name = "My edit v2"
	data, _ = json.Marshal(doc)
	req = httptest.NewRequest(http.MethodPut, "/api/admin/layouts/my-edit", bytes.NewReader(data))
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, body %s", rec.Code, rec.Body.String())
	}
	// Delete (should succeed because not default and not builtin)
	req = httptest.NewRequest(http.MethodDelete, "/api/admin/layouts/my-edit", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, body %s", rec.Code, rec.Body.String())
	}
	// Builtin delete -> 403
	req = httptest.NewRequest(http.MethodDelete, "/api/admin/layouts/xbox-default", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("builtin delete status = %d, want 403", rec.Code)
	}
	// Non-loopback should be forbidden
	req = httptest.NewRequest(http.MethodGet, "/api/admin/layouts/xbox-default", nil)
	req.RemoteAddr = "192.168.1.20:4321"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-loopback status = %d, want 403", rec.Code)
	}
}

func TestPublishPendingAndAccept(t *testing.T) {
	server, _, sess := newTestHTTPServerWithUserDir(t, "127.0.0.1", t.TempDir())
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	defer server.Close(nil)

	// Admit a phone player via transport WS so we have a playerId
	wsURL := "ws://127.0.0.1:" + strconv.Itoa(server.publicPort) + "/ws"
	dialer := websocket.Dialer{}
	origin := "http://127.0.0.1:" + strconv.Itoa(server.publicPort)
	conn, _, err := dialer.Dial(wsURL, map[string][]string{"Origin": {origin}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(protocol.Hello{Type: protocol.MessageHello, SessionCode: sess.Code(), ClientVersion: "test"}); err != nil {
		t.Fatal(err)
	}
	// Read welcome + layout
	for i := 0; i < 2; i++ {
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatal(err)
		}
	}
	// Get playerId from session
	players := sess.Players()
	if len(players) != 1 {
		t.Fatalf("players = %d, want 1", len(players))
	}
	playerID := players[0].ID

	// Connect admin WS
	adminURL := "ws://127.0.0.1:" + strconv.Itoa(server.publicPort) + "/api/admin/ws"
	adminConn, _, err := websocket.DefaultDialer.Dial(adminURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer adminConn.Close()
	// Read initial state
	if _, _, err := adminConn.ReadMessage(); err != nil {
		t.Fatal(err)
	}

	// Publish a layout from phone (public endpoint)
	doc := layout.Document{
		ID: "my-publish", Name: "My publish", SchemaVersion: 1,
		Sections: []layout.Section{
			{ID: "left", RelativeWidth: 0.86, Controls: []layout.Control{}},
			{ID: "center", RelativeWidth: 0.5, Controls: []layout.Control{}},
			{ID: "right", RelativeWidth: 0.94, Controls: []layout.Control{}},
		},
	}
	publishBody, _ := json.Marshal(map[string]any{"playerId": playerID, "document": doc})
	req := httptest.NewRequest(http.MethodPost, "/api/layouts/publish", bytes.NewReader(publishBody))
	req.RemoteAddr = "127.0.0.1:1234"
	// Need to set origin to pass SameOrigin? Our handler checks transport.SameOrigin which requires origin matches host. Provide no origin to allow.
	handler := server.routes(false)
	rec := httptest.NewRecorder()
	// Use direct handler call for publish (public route) - but server.routes(false) includes publish handler with SameOrigin check that allows empty origin.
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("publish status = %d, body %s", rec.Code, rec.Body.String())
	}
	var resp map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	pendingID := resp["id"]
	if pendingID == "" {
		t.Fatal("no pending id")
	}

	// Admin should receive pending notification (skip periodic state pushes).
	_ = readAdminPending(t, adminConn, pendingID)

	// Accept via admin
	acceptReq := httptest.NewRequest(http.MethodPost, "/api/admin/layouts/publish/"+pendingID+"/accept", nil)
	acceptReq.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, acceptReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("accept status = %d, body %s", rec.Code, rec.Body.String())
	}

	// Phone should receive publish.result accepted (skip layouts broadcast).
	_ = readPhonePublishResult(t, conn, pendingID, "accepted")
	// Accept must also push the fresh catalogue so the phone picker updates.
	layoutsMsg := readPhoneLayouts(t, conn)
	found := false
	for _, summary := range layoutsMsg.Layouts {
		if summary.ID == "my-publish" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("layouts broadcast missing my-publish: %+v", layoutsMsg)
	}

	// Verify layout now exists via admin get
	getReq := httptest.NewRequest(http.MethodGet, "/api/admin/layouts/my-publish", nil)
	getReq.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, getReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("get after accept status = %d", rec.Code)
	}
	// Second accept should 404 (already removed)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, acceptReq)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("second accept status = %d, want 404", rec.Code)
	}
	// Publish conflict: try to publish same id again, accept should 409
	publishBody, _ = json.Marshal(map[string]any{"playerId": playerID, "document": doc})
	req = httptest.NewRequest(http.MethodPost, "/api/layouts/publish", bytes.NewReader(publishBody))
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("second publish status = %d", rec.Code)
	}
	var resp2 map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &resp2)
	conflictID := resp2["id"]
	// Drain admin pending (skip periodic state pushes).
	_ = readAdminPending(t, adminConn, conflictID)
	acceptReq2 := httptest.NewRequest(http.MethodPost, "/api/admin/layouts/publish/"+conflictID+"/accept", nil)
	acceptReq2.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, acceptReq2)
	if rec.Code != http.StatusConflict {
		t.Fatalf("conflict accept status = %d, want 409", rec.Code)
	}
	// Pending should still exist, decline it
	declineReq := httptest.NewRequest(http.MethodPost, "/api/admin/layouts/publish/"+conflictID+"/decline", nil)
	declineReq.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, declineReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("decline status = %d", rec.Code)
	}
	// Phone should get declined
	_ = readPhonePublishResult(t, conn, conflictID, "declined")
	// Ensure cancel works: publish again then cancel via DELETE
	publishBody, _ = json.Marshal(map[string]any{"playerId": playerID, "document": map[string]any{"id": "cancel-test", "name": "Cancel", "schemaVersion": 1, "sections": []any{map[string]any{"id": "left", "relativeWidth": 0.86, "controls": []any{}}, map[string]any{"id": "center", "relativeWidth": 0.5, "controls": []any{}}, map[string]any{"id": "right", "relativeWidth": 0.94, "controls": []any{}}}}})
	req = httptest.NewRequest(http.MethodPost, "/api/layouts/publish", bytes.NewReader(publishBody))
	req.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var resp3 map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &resp3)
	cancelID := resp3["id"]
	_ = readAdminPending(t, adminConn, cancelID)
	cancelReq := httptest.NewRequest(http.MethodDelete, "/api/layouts/publish/"+cancelID, nil)
	cancelReq.RemoteAddr = "127.0.0.1:1234"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, cancelReq)
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel status = %d", rec.Code)
	}
	_ = readPhonePublishResult(t, conn, cancelID, "cancelled")
}

func readAdminPending(t *testing.T, adminConn *websocket.Conn, wantID string) []byte {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for i := 0; i < 10; i++ {
		adminConn.SetReadDeadline(deadline)
		_, data, err := adminConn.ReadMessage()
		if err != nil {
			t.Fatalf("admin pending not received: %v", err)
		}
		var pending protocol.PublishPending
		if err := json.Unmarshal(data, &pending); err != nil {
			continue
		}
		if pending.Type == protocol.MessagePublishPending && pending.ID == wantID {
			return data
		}
	}
	t.Fatalf("admin pending %q not received", wantID)
	return nil
}

func readPhonePublishResult(t *testing.T, conn *websocket.Conn, wantID, wantStatus string) protocol.PublishResult {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for i := 0; i < 10; i++ {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("publish result not received: %v", err)
		}
		var result protocol.PublishResult
		if err := json.Unmarshal(data, &result); err != nil {
			continue
		}
		if result.Type == protocol.MessagePublishResult && result.ID == wantID && result.Status == wantStatus {
			return result
		}
	}
	t.Fatalf("publish result %q=%q not received", wantID, wantStatus)
	return protocol.PublishResult{}
}

func readPhoneLayouts(t *testing.T, conn *websocket.Conn) protocol.LayoutsMessage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for i := 0; i < 10; i++ {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("layouts broadcast not received: %v", err)
		}
		var msg protocol.LayoutsMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == protocol.MessageLayouts {
			return msg
		}
	}
	t.Fatalf("layouts broadcast not received")
	return protocol.LayoutsMessage{}
}
