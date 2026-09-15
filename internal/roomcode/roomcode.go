// Package roomcode implements the persistent room-code format.
package roomcode

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"
)

const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// validChar is an O(1) lookup for Validate; alphabet is ASCII-only.
var validChar = func() [128]bool {
	var t [128]bool
	for i := 0; i < len(alphabet); i++ {
		t[alphabet[i]] = true
	}
	return t
}()

// GeneratedLength is the length of auto-generated room codes.
const GeneratedLength = 6

// MinLength and MaxLength bound custom codes after normalization.
const (
	MinLength = 4
	MaxLength = 24
)

// Normalize folds a user-entered code to its canonical lookup form.
func Normalize(code string) string {
	code = strings.TrimSpace(code)
	code = strings.ToUpper(code)
	return strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return r
	}, code)
}

// Validate rejects anything outside the room-code alphabet after normalization.
func Validate(code string) error {
	normalized := Normalize(code)
	runes := []rune(normalized)
	if len(runes) < MinLength || len(runes) > MaxLength {
		return fmt.Errorf("room code must be %d-%d characters after normalization, got %d", MinLength, MaxLength, len(runes))
	}
	for _, r := range runes {
		if r >= 128 || !validChar[r] {
			return fmt.Errorf("room code contains invalid character %q (allowed: A-Z except I/L/O, 2-9, dash)", r)
		}
	}
	return nil
}

// Generate returns a random 6-char code from the room-code alphabet.
func Generate() (string, error) {
	out := make([]byte, GeneratedLength)
	// 31 symbols; reject bytes >= 248 so the pick stays uniform.
	var buf [16]byte
	filled := 0
	for filled < GeneratedLength {
		if _, err := rand.Read(buf[:]); err != nil {
			return "", fmt.Errorf("generate room code: %w", err)
		}
		for _, b := range buf {
			if b < 248 {
				out[filled] = alphabet[int(b)%len(alphabet)]
				filled++
				if filled == GeneratedLength {
					break
				}
			}
		}
	}
	return string(out), nil
}

// GenerateInstallationKey returns a random 32-byte hex ownership key.
func GenerateInstallationKey() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate installation key: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}
