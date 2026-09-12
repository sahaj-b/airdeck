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

const (
	colorRed    = "31"
	colorGreen  = "32"
	colorYellow = "33"
)

// colorsEnabled reports whether stdout is a terminal and NO_COLOR is unset.
func colorsEnabled() bool {
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	info, err := os.Stdout.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func paint(code, text string) string {
	if !colorsEnabled() {
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "airdeck:", paint(colorRed, err.Error()))
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
	if os.Geteuid() == 0 {
		fmt.Fprintln(os.Stderr, paint(colorYellow, "warning: doctor as root checks root's access, not yours; rerun as your normal user"))
	}
	report, err := doctor.Run(*cleanup)
	for _, check := range report.Checks {
		fmt.Printf("%-32s %s: %s\n", check.Name, checkStatus(check), check.Detail)
	}
	for _, leftover := range report.Leftovers {
		fmt.Println(paint(colorRed, "leftover airdeck device: "+leftover))
	}
	return err
}

// signalTrap cancels its context on the first SIGINT/SIGTERM and force-exits
// the process on the second. A wedged shutdown must never eat the terminal:
// the first press starts graceful teardown, the next one always kills.
func signalTrap() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-signals
		fmt.Fprintln(os.Stderr, "airdeck: received "+sig.String()+", shutting down (press Ctrl-C again to force quit)")
		cancel()
		sig = <-signals
		fmt.Fprintln(os.Stderr, "airdeck: received "+sig.String()+" again, forcing exit")
		os.Exit(130)
	}()
	return ctx, func() {
		signal.Stop(signals)
		cancel()
	}
}

func checkStatus(check doctor.Check) string {
	code, text := colorGreen, "ok"
	if !check.OK {
		code, text = colorRed, "fail"
		if check.Critical {
			code = "1;" + colorRed
		}
	}
	return paint(code, text)
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
	gracePeriod := flags.Int("grace-period", 0, "reconnect grace period override in seconds")
	noCode := flags.Bool("no-code", false, "let clients join /join without entering a session code")
	flags.BoolVar(noCode, "n", false, "shorthand for --no-code")
	roomCode := flags.String("room-code", "", "persistent room code override")
	lanOnly := flags.Bool("lan-only", false, "serve LAN only without probing central")
	approvalRequired := flags.Bool("approval-required", false, "require host approval before admitting joins")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if os.Geteuid() == 0 {
		return errors.New("serve must run as your normal user, not as root; run it without sudo")
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
	if *gracePeriod != 0 {
		overrides.GracePeriodSeconds = gracePeriod
	}
	if *noCode {
		overrides.NoCode = noCode
	}
	if *roomCode != "" {
		overrides.RoomCode = roomCode
	}
	if *lanOnly {
		overrides.LanOnly = lanOnly
	}
	if *approvalRequired {
		overrides.ApprovalRequired = approvalRequired
	}
	cfg, err = config.ApplyOverrides(cfg, overrides)
	if err != nil {
		return err
	}
	application, err := app.New(cfg, *configPath)
	if err != nil {
		return err
	}
	ctx, stop := signalTrap()
	defer stop()
	return application.Run(ctx)
}
