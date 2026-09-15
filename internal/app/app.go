package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/mdp/qrterminal/v3"
	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/httpserver"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/online"
	"github.com/sahaj-b/airdeck/internal/rtchost"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
	"github.com/sahaj-b/airdeck/internal/web"
)

// shutdownTimeout bounds the whole graceful shutdown. Device teardown is
// internally bounded too; this is the backstop for the listener drain.
const shutdownTimeout = 10 * time.Second

type App struct {
	Config       config.Config
	ConfigPath   string
	Layouts      *layout.Library
	Session      *session.Session
	Devices      *device.Manager
	Input        *input.Handler
	Transport    *transport.Server
	Peers        *rtchost.PeerManager
	Online       *online.Agent
	HTTP         *httpserver.Server
	shutdownOnce sync.Once
}

func New(cfg config.Config, configPath string) (*App, error) {
	layouts, err := layout.LoadDefault(config.LayoutsDir(), cfg.DefaultLayout)
	if err != nil {
		return nil, err
	}
	devices := device.NewManager(device.UInputFactory{})
	sess, err := session.New(layouts, devices, time.Duration(cfg.GracePeriodSeconds)*time.Second)
	if err != nil {
		return nil, err
	}
	sess.SetCode(cfg.RoomCode)
	sess.SetCodeRequired(!cfg.NoCode)
	sess.SetApprovalRequired(cfg.ApprovalRequired)
	handler := input.NewHandler(sess)
	transportServer := transport.NewServer(sess, handler, layouts, cfg.InputRate)
	peers := rtchost.New(sess, handler, layouts, cfg.InputRate)
	httpServer := httpserver.New(httpserver.Options{Config: cfg, Session: sess, Input: handler, Transport: transportServer, Layouts: layouts, Static: web.FS(), OnSettings: func(updated config.Config) error {
		if configPath == "" {
			return nil
		}
		return config.Save(configPath, updated)
	}})
	agent := online.New(online.Options{
		InstallationKey:  cfg.InstallationKey,
		ApprovalRequired: cfg.ApprovalRequired, LanOnly: cfg.LanOnly,
		Session: sess, Peers: peers,
		OnStateChange: func() {
			httpServer.BroadcastAdminState()
			// Reprint so the terminal tracks the dashboard QR flip.
			joinURL := httpServer.AdvertisedJoinURL()
			log.Printf("join URL %s", joinURL)
			printJoinQR(joinURL)
		},
	})
	httpServer.SetOnline(agent)
	return &App{Config: cfg, ConfigPath: configPath, Layouts: layouts, Session: sess, Devices: devices, Input: handler, Transport: transportServer, Peers: peers, Online: agent, HTTP: httpServer}, nil
}

func (a *App) Run(ctx context.Context) error {
	a.Online.Start()
	if err := a.HTTP.Start(); err != nil {
		return err
	}
	joinURL := a.HTTP.AdvertisedJoinURL()
	log.Printf("dashboard URL %s", a.HTTP.DashboardURL())
	log.Printf("session %s, join URL %s", a.Session.Code(), joinURL)
	printJoinQR(joinURL)
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	return a.Shutdown(shutdownCtx)
}

func printJoinQR(joinURL string) {
	info, err := os.Stdout.Stat()
	if err != nil || info.Mode()&os.ModeCharDevice == 0 {
		return
	}
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "scan to join:")
	cfg := qrterminal.Config{
		Level:      qrterminal.L,
		Writer:     os.Stdout,
		HalfBlocks: true,
		QuietZone:  1,
	}
	qrterminal.GenerateWithConfig(joinURL, cfg)
}

func (a *App) Shutdown(ctx context.Context) error {
	var first error
	a.shutdownOnce.Do(func() {
		log.Printf("shutting down")
		a.Session.SetAcceptingJoins(false)
		log.Printf("shutting down: stopping central registration")
		a.Online.Close()
		log.Printf("shutting down: closing phone connections")
		a.Peers.Close()
		a.Transport.Close()
		a.HTTP.CloseConnections()
		a.Input.Close()
		log.Printf("shutting down: destroying virtual devices")
		if err := a.Session.Close(); err != nil && first == nil {
			first = err
		}
		log.Printf("shutting down: closing HTTP listeners")
		if err := a.HTTP.Close(ctx); err != nil && first == nil {
			first = err
		}
		log.Printf("shutdown complete")
	})
	return first
}
