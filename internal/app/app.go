package app

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/diagnostics"
	"github.com/sahaj-b/airdeck/internal/httpserver"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/transport"
	"github.com/sahaj-b/airdeck/internal/web"
)

type App struct {
	Config       config.Config
	ConfigPath   string
	Layouts      *layout.Library
	Session      *session.Session
	Devices      *device.Manager
	Input        *input.Handler
	Transport    *transport.Server
	HTTP         *httpserver.Server
	Trace        *diagnostics.Trace
	Metrics      *diagnostics.Metrics
	shutdownOnce sync.Once
}

func New(cfg config.Config, configPath string) (*App, error) {
	layouts, err := layout.LoadDefault(config.LayoutsDir(), cfg.DefaultLayout)
	if err != nil {
		return nil, err
	}
	devices := device.NewManager(device.UInputFactory{})
	sess, err := session.New(layouts, devices)
	if err != nil {
		return nil, err
	}
	trace := diagnostics.NewTrace(4096)
	metrics := &diagnostics.Metrics{}
	handler := input.NewHandler(sess, trace, metrics)
	transportServer := transport.NewServer(sess, handler, layouts, cfg.InputRate)
	httpServer := httpserver.New(httpserver.Options{Config: cfg, Session: sess, Input: handler, Transport: transportServer, Layouts: layouts, Static: web.FS(), OnSettings: func(updated config.Config) error {
		if configPath == "" {
			return nil
		}
		return config.Save(configPath, updated)
	}})
	return &App{Config: cfg, ConfigPath: configPath, Layouts: layouts, Session: sess, Devices: devices, Input: handler, Transport: transportServer, HTTP: httpServer, Trace: trace, Metrics: metrics}, nil
}

func (a *App) Run(ctx context.Context) error {
	if err := a.HTTP.Start(); err != nil {
		return err
	}
	log.Printf("dashboard URL %s", a.HTTP.DashboardURL())
	log.Printf("session %s, join URL %s", a.Session.Code(), a.HTTP.AdvertisedJoinURL())
	resourceDone := make(chan struct{})
	go a.sampleResources(resourceDone)
	<-ctx.Done()
	close(resourceDone)
	return a.Shutdown(context.Background())
}

func (a *App) sampleResources(done <-chan struct{}) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			a.Metrics.Resource(diagnostics.Sample(len(a.Session.Players())))
		}
	}
}

func (a *App) Shutdown(ctx context.Context) error {
	var first error
	a.shutdownOnce.Do(func() {
		a.Session.SetAcceptingJoins(false)
		a.Transport.Close()
		a.HTTP.CloseConnections()
		a.Input.Close()
		if err := a.Session.Close(); err != nil && first == nil {
			first = err
		}
		if err := a.HTTP.Close(ctx); err != nil && first == nil {
			first = err
		}
	})
	return first
}
