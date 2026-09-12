// Package relay is the v2a signal relay: durable room-code claims plus
// live join routing between hosts and phones (PLAN Phase 3).
//
// Wire endpoints (paths are relay-local, not part of the rtc contract):
//
//	GET  /health    liveness probe for the host reachability check
//	WS   /register  host register loop (no Origin check, non-browser)
//	WS   /join      guest joins (join-page Origin allowlist enforced)
//
// The host holds one outbound /register socket; each phone holds one /join
// socket only until its SDP exchange completes, then closes it.
// Post-establishment state lives in host PeerConnections, never in relay
// messages.
package relay

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

func newID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}
