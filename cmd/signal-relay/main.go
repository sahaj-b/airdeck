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
	"strings"
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
	turnStaticSecret := flags.String("turn-static-secret", "", "self-hosted coturn static-auth-secret (or AIRDECK_TURN_STATIC_SECRET)")
	turnURLs := flags.String("turn-urls", "", "self-hosted TURN urls, comma-separated, e.g. turn:signal.airdeck.sahaj.dev:3478?transport=udp (or AIRDECK_TURN_URLS)")
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
	if *turnStaticSecret == "" {
		*turnStaticSecret = os.Getenv("AIRDECK_TURN_STATIC_SECRET")
	}
	if *turnURLs == "" {
		*turnURLs = os.Getenv("AIRDECK_TURN_URLS")
	}
	store, err := relay.Open(*dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()
	provider := turn.New(*turnKeyID, *turnSecret)
	staticURLs := splitTurnURLs(*turnURLs)
	provider.SetStatic(*turnStaticSecret, staticURLs)
	if *turnKeyID == "" || *turnSecret == "" {
		if *turnStaticSecret != "" && len(staticURLs) > 0 {
			log.Printf("signal-relay: using self-hosted TURN (%d urls)", len(staticURLs))
		} else {
			log.Printf("signal-relay: no TURN credentials, serving STUN-only iceServers")
		}
	} else if *turnStaticSecret != "" && len(staticURLs) > 0 {
		log.Printf("signal-relay: Cloudflare TURN primary, self-hosted fallback (%d urls)", len(staticURLs))
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

// splitTurnURLs parses the comma-separated --turn-urls flag. Empty items
// and surrounding whitespace are dropped; STUN entries are dropped too
// (SplitMinted backfills STUN automatically, and a static bundle should
// never carry credentials on a STUN url).
func splitTurnURLs(raw string) []string {
	var out []string
	for _, item := range strings.Split(raw, ",") {
		url := strings.TrimSpace(item)
		if url == "" || strings.HasPrefix(strings.ToLower(url), "stun:") {
			continue
		}
		out = append(out, url)
	}
	return out
}
