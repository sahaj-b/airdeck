package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

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
