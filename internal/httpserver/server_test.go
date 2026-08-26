package httpserver

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/diagnostics"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
	"github.com/sahaj-b/airdeck/internal/uinput"
	"github.com/sahaj-b/airdeck/internal/web"
)

type serverFakeDevice struct{}

func (serverFakeDevice) Apply(uinput.State) error { return nil }
func (serverFakeDevice) Neutralize() error        { return nil }
func (serverFakeDevice) Destroy() error           { return nil }
func (serverFakeDevice) Syspath() (string, error) { return "fake", nil }

type serverFakeFactory struct{}

func (serverFakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	return serverFakeDevice{}, nil
}

func newTestHTTPServer(t *testing.T, bind string) (*Server, config.Config, *session.Session) {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := session.New(library, device.NewManager(serverFakeFactory{}))
	if err != nil {
		t.Fatal(err)
	}
	handler := input.NewHandler(sess, diagnostics.NewTrace(16), &diagnostics.Metrics{})
	transportServer := transport.NewServer(sess, handler, library, 60)
	cfg := config.Defaults()
	cfg.Bind = bind
	cfg.Port = freePort(t)
	return New(Options{Config: cfg, Session: sess, Input: handler, Transport: transportServer, Layouts: library, Static: web.FS()}), cfg, sess
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

func TestAdvertisedURLHandlesIPv6AndCodes(t *testing.T) {
	if got := advertisedURL("::1", 6969, "0042"); got != "http://[::1]:6969/join?code=0042" {
		t.Fatalf("advertised URL = %q", got)
	}
}

func TestServerCanRestartAfterClose(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	if err := server.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	if server.publicLn != nil || server.adminLn != nil {
		t.Fatal("listener fields were not cleared")
	}
	if err := server.Start(); err != nil {
		t.Fatal("server did not restart: ", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Close(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAdminRoutesUseRemoteAddressForLoopbackGuard(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	handler := server.routes(false)
	for _, path := range []string{"/dashboard", "/api/admin/state", "/api/admin/ws"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "192.168.1.20:4321"
		req.Header.Set("X-Forwarded-For", "127.0.0.1")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s status = %d, want %d", path, response.Code, http.StatusForbidden)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/state", nil)
	req.RemoteAddr = "[::ffff:127.0.0.1]:4321"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("mapped loopback status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestAdminJoinToggleReturnsUpdatedState(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	req := httptest.NewRequest(http.MethodPut, "/api/admin/joins", strings.NewReader(`{"acceptingJoins":false}`))
	req.RemoteAddr = "127.0.0.1:4321"
	response := httptest.NewRecorder()
	server.routes(false).ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("toggle status = %d, body = %s", response.Code, response.Body.String())
	}
	var state adminState
	if err := json.Unmarshal(response.Body.Bytes(), &state); err != nil {
		t.Fatal(err)
	}
	if state.AcceptingJoins {
		t.Fatal("admin state still accepts joins")
	}
}

func TestAdminWebSocketStreamsSnapshotAndEvents(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	wsURL := "ws://127.0.0.1:" + strconv.Itoa(server.publicPort) + "/api/admin/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var initial adminState
	if err := json.Unmarshal(data, &initial); err != nil {
		t.Fatalf("initial snapshot is not an adminState: %v", err)
	}
	if initial.Code == "" || !initial.AcceptingJoins {
		t.Fatalf("initial snapshot = %+v", initial)
	}
	sess.SetAcceptingJoins(false)
	_, data, err = conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var event adminEvent
	if err := json.Unmarshal(data, &event); err != nil {
		t.Fatalf("update is not an adminEvent: %v", err)
	}
	if event.Type != "joins" || event.State.AcceptingJoins {
		t.Fatalf("event = %+v", event)
	}
}

func TestRebindFromSettingsHandlerDoesNotDeadlock(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	oldPort := server.publicPort
	targetPort := freePort(t)
	client := &http.Client{Timeout: 5 * time.Second}
	body := strings.NewReader(`{"port":` + strconv.Itoa(targetPort) + `}`)
	req, err := http.NewRequest(http.MethodPut, "http://127.0.0.1:"+strconv.Itoa(oldPort)+"/api/admin/settings", body)
	if err != nil {
		t.Fatal(err)
	}
	req.RemoteAddr = "127.0.0.1:12345"
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("settings rebind from its own handler: %v", err)
	}
	resp.Body.Close()
	if server.publicPort != targetPort {
		t.Fatalf("public port = %d, want %d", server.publicPort, targetPort)
	}
	// The replacement listener must actually serve requests.
	stateReq, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(targetPort)+"/api/admin/state", nil)
	stateReq.RemoteAddr = "127.0.0.1:12345"
	stateResp, err := client.Do(stateReq)
	if err != nil {
		t.Fatalf("state on new port: %v", err)
	}
	stateResp.Body.Close()
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("state status on new port = %d", stateResp.StatusCode)
	}
}

func TestRebindMaintainsLoopbackAdminListener(t *testing.T) {
	server, cfg, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	cfg.Bind = "0.0.0.0"
	if err := server.Rebind(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if server.adminLn == nil {
		t.Fatal("non-loopback bind has no admin listener")
	}
	cfg.Bind = "127.0.0.1"
	if err := server.Rebind(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if server.adminLn != nil {
		t.Fatal("loopback bind retained a separate admin listener")
	}
	cfg.Bind = "0.0.0.0"
	if err := server.Rebind(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if server.adminLn == nil {
		t.Fatal("admin listener was not recreated")
	}
	if err := server.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestListenFallbackAdvancesPastOccupiedPort(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	port := occupied.Addr().(*net.TCPAddr).Port
	server, _, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	server.mu.Lock()
	server.options.Config.Port = port
	server.mu.Unlock()
	if err := server.Start(); err != nil {
		t.Fatalf("start with occupied port: %v", err)
	}
	if server.publicPort != port+1 {
		t.Fatalf("public port = %d, want %d", server.publicPort, port+1)
	}
	if err := server.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestStartFailsOnUnavailableBindAddress(t *testing.T) {
	server, _, sess := newTestHTTPServer(t, "192.0.2.1")
	defer sess.Close()
	if err := server.Start(); err == nil {
		t.Fatal("start on an unavailable bind address succeeded")
	}
	if server.publicLn != nil || server.adminLn != nil {
		t.Fatal("failed start left listeners installed")
	}
}

func TestRebindFailureKeepsOldListenerAlive(t *testing.T) {
	server, cfg, sess := newTestHTTPServer(t, "127.0.0.1")
	defer sess.Close()
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	oldPort := server.publicPort
	cfg.Bind = "192.0.2.1"
	if err := server.Rebind(context.Background(), cfg); err == nil {
		t.Fatal("rebind to an unavailable address succeeded")
	}
	if server.publicPort != oldPort {
		t.Fatalf("public port = %d after failed rebind, want %d", server.publicPort, oldPort)
	}
	client := &http.Client{Timeout: 2 * time.Second}
	stateReq, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+strconv.Itoa(oldPort)+"/api/admin/state", nil)
	stateReq.RemoteAddr = "127.0.0.1:12345"
	response, err := client.Do(stateReq)
	if err != nil {
		t.Fatalf("old listener after failed rebind: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("old listener status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if err := server.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
