package httpserver

import (
	"context"
	"net"
	"testing"
	"time"

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
