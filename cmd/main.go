package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/sahaj-b/airdeck/internal/app"
	"github.com/sahaj-b/airdeck/internal/config"
	"github.com/sahaj-b/airdeck/internal/doctor"
	"github.com/sahaj-b/airdeck/internal/setup"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "airdeck:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: airdeck doctor | setup | serve")
	}
	switch args[0] {
	case "doctor":
		return runDoctor(args[1:])
	case "setup":
		return setup.Run()
	case "serve":
		return runServe(args[1:])
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func runDoctor(args []string) error {
	flags := flag.NewFlagSet("doctor", flag.ContinueOnError)
	cleanup := flags.Bool("cleanup", false, "report provably airdeck-owned leftover devices")
	if err := flags.Parse(args); err != nil {
		return err
	}
	report, err := doctor.Run(*cleanup)
	for _, check := range report.Checks {
		fmt.Printf("%-32s %s: %s\n", check.Name, status(check.OK), check.Detail)
	}
	for _, leftover := range report.Leftovers {
		fmt.Println("leftover airdeck device:", leftover)
	}
	return err
}

func status(ok bool) string {
	if ok {
		return "ok"
	}
	return "fail"
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	configPath := flags.String("config", config.File(), "configuration file")
	bind := flags.String("bind", "", "bind address override")
	port := flags.Int("port", 0, "port override")
	advertisedHost := flags.String("advertised-host", "", "advertised host override")
	advertisedPort := flags.Int("advertised-port", -1, "advertised port override")
	defaultLayout := flags.String("default-layout", "", "default layout override")
	inputRate := flags.Int("input-rate", 0, "startup input rate override")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if os.Geteuid() == 0 {
		return errors.New("serve must run as the normal user; run airdeck setup as root first")
	}
	if _, err := doctor.Run(false); err != nil {
		return fmt.Errorf("serve prerequisites: %w", err)
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	overrides := config.Overrides{}
	if *bind != "" {
		overrides.Bind = bind
	}
	if *port != 0 {
		overrides.Port = port
	}
	if *advertisedHost != "" {
		overrides.AdvertisedHost = advertisedHost
	}
	if *advertisedPort >= 0 {
		overrides.AdvertisedPort = advertisedPort
	}
	if *defaultLayout != "" {
		overrides.DefaultLayout = defaultLayout
	}
	if *inputRate != 0 {
		overrides.InputRate = inputRate
	}
	cfg, err = config.ApplyOverrides(cfg, overrides)
	if err != nil {
		return err
	}
	application, err := app.New(cfg, *configPath)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return application.Run(ctx)
}
