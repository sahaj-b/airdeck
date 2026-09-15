// Command signal-relay holds the room-code claim database and routes
// SDP between hosts and phones.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sahaj-b/airdeck/cmd/signal-relay/relay"
	"github.com/sahaj-b/airdeck/internal/turn"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "signal-relay:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	flags := flag.NewFlagSet("signal-relay", flag.ContinueOnError)
	listen := flags.String("listen", ":8080", "address to listen on")
	dbPath := flags.String("db", "signal-relay.db", "SQLite claim database path")
	turnKeyID := flags.String("turn-key-id", "", "Cloudflare TURN key id (or AIRDECK_TURN_KEY_ID)")
	turnSecret := flags.String("turn-secret", "", "Cloudflare TURN key secret (or AIRDECK_TURN_KEY_SECRET)")
	enforceLimits := flags.Bool("enforce-limits", false, "enforce registration rate limits, code-change caps, and the reserved list (off for dev, on in prod)")
	dev := flags.Bool("dev", false, "allow localhost guest origins for local drills")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *turnKeyID == "" {
		*turnKeyID = os.Getenv("AIRDECK_TURN_KEY_ID")
	}
	if *turnSecret == "" {
		*turnSecret = os.Getenv("AIRDECK_TURN_KEY_SECRET")
	}
	store, err := relay.Open(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()
	provider := turn.New(*turnKeyID, *turnSecret)
	if *turnKeyID == "" || *turnSecret == "" {
		log.Printf("signal-relay: no TURN credentials, serving STUN-only iceServers")
	}
	hub := relay.NewHub(store, provider, *enforceLimits)
	server := &http.Server{
		Addr:         *listen,
		Handler:      relay.NewServer(hub, *dev).Routes(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}
	go func() {
		signals := make(chan os.Signal, 2)
		signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
		<-signals
		log.Printf("signal-relay: shutting down")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Printf("signal-relay: listening on %s (db=%s enforce-limits=%v dev=%v)", *listen, *dbPath, *enforceLimits, *dev)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("listen: %w", err)
	}
	return nil
}
