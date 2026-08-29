package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"unicode/utf8"
)

const (
	MessageHello          = "hello"
	MessageWelcome        = "welcome"
	MessagePing           = "ping"
	MessagePong           = "pong"
	MessageLayout         = "layout"
	MessageLayoutSelect   = "layout.select"
	MessageRumble         = "rumble"
	MessageError          = "error"
	MessageClose          = "close"
	MessageReset          = "session.reset"
	MessageDebugTrace     = "debug.inputTrace"
	MessagePublishPending = "layout.publish.pending"
	MessagePublishResult  = "publish.result"
)

type Envelope struct {
	Type string `json:"type"`
}

func MessageType(data []byte) (string, error) {
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", fmt.Errorf("decode message: %w", err)
	}
	if envelope.Type == "" {
		return "", fmt.Errorf("message type is required")
	}
	return envelope.Type, nil
}

func DecodeHello(data []byte) (Hello, error) {
	var message Hello
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return message, fmt.Errorf("decode hello: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return message, fmt.Errorf("decode hello: trailing data")
	}
	if message.Type != MessageHello {
		return message, fmt.Errorf("expected %q message", MessageHello)
	}
	// An empty code is allowed at this layer so no-code sessions can admit
	// without one; Session.Admit still enforces the code when it is required.
	if message.SessionCode != "" && (len(message.SessionCode) != 4 || !digitsOnly(message.SessionCode)) {
		return message, fmt.Errorf("session code must contain exactly four digits")
	}
	if !utf8.ValidString(message.DisplayName) || utf8.RuneCountInString(message.DisplayName) > 40 {
		return message, fmt.Errorf("display name must be at most 40 characters")
	}
	if len(message.ReconnectID) > 128 || len(message.SelectedLayout) > 64 || message.ClientVersion == "" || len(message.ClientVersion) > 80 {
		return message, fmt.Errorf("hello contains an invalid identifier or client version")
	}
	return message, nil
}

func digitsOnly(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
