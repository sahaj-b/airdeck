// Package relay holds the durable room-code claim database and routes SDP
// between hosts and phones: GET /health for the host probe, WS /register
// for hosts, WS /join for guests. Live input never flows through it.
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
