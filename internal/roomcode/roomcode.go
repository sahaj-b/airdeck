// Package roomcode implements the persistent room-code format from SPEC v2a.
//
// Generated codes are 6 chars from a Crockford-style alphabet (A-Z/2-9
// minus ambiguous 0/O, 1/I/L). Custom codes are 4-24 chars from the same
// alphabet plus dash. Normalization before lookup and claiming: trim,
// uppercase, strip dashes and spaces.
package roomcode

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"unicode"
	"unicode/utf8"
)

// alphabet is A-Z minus I/L/O plus 2-9 (0 and 1 excluded as ambiguous).
// 23 letters + 8 digits = 31 chars.
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// GeneratedLength is the length of auto-generated room codes.
const GeneratedLength = 6

// MinLength and MaxLength bound custom codes after normalization.
const (
	MinLength = 4
	MaxLength = 24
)

// Normalize folds a user-entered code to its canonical lookup form:
// trim, uppercase, strip dashes and spaces.
func Normalize(code string) string {
	code = strings.TrimSpace(code)
	code = strings.ToUpper(code)
	// Strip dashes and whitespace (spaces, tabs, etc.) so "ab-cd 12"
	// and "ABCD12" claim the same room.
	return strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return r
	}, code)
}

// Validate rejects anything that is not 4-24 chars from the room-code
// alphabet after normalization. Dashes, spaces, and lowercase are accepted
// pre-normalization; ambiguous 0/O/1/I/L never validate.
func Validate(code string) error {
	normalized := Normalize(code)
	length := utf8.RuneCountInString(normalized)
	if length < MinLength || length > MaxLength {
		return fmt.Errorf("room code must be %d-%d characters after normalization, got %d", MinLength, MaxLength, length)
	}
	for _, r := range normalized {
		if !strings.ContainsRune(alphabet, r) {
			return fmt.Errorf("room code contains invalid character %q (allowed: A-Z except I/L/O, 2-9, dash)", r)
		}
	}
	return nil
}

// Generate returns a random 6-char code from the room-code alphabet.
func Generate() (string, error) {
	out := make([]byte, GeneratedLength)
	max := big.NewInt(int64(len(alphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generate room code: %w", err)
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out), nil
}

// GenerateInstallationKey returns a random 32-byte hex key proving ownership
// of a room-code claim. It is stored 0600 in host config and never logged.
func GenerateInstallationKey() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate installation key: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}
