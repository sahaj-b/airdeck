// Package rtc is the shared signaling contract for the online path.
// TypeScript is derived via tygo codegen, never hand-duplicated.
package rtc

import (
	"encoding/json"
	"fmt"

	"github.com/sahaj-b/airdeck/internal/roomcode"
)

// Signaling message types on the host<->relay and phone<->relay sockets.
const (
	MessageRegister   = "register"
	MessageRegistered = "registered"
	MessageConflict   = "conflict"
	MessageJoin       = "join"
	MessageJoined     = "joined"
	MessagePending    = "pending"
	MessageAccepted   = "accepted"
	MessageOffer      = "offer"
	MessageAnswer     = "answer"
	MessageAccept     = "accept"
	MessageReject     = "reject"
	MessageRejected   = "rejected"
	MessageError      = "error"
	MessagePeerLeft   = "peer.left"
)

// Relay error codes. RoomNotFound is the single generic code for unknown,
// retired, and offline-host codes.
const (
	ErrorRoomNotFound = "room_not_found"
	ErrorPendingGone  = "pending_gone"
)

// Envelope carries only the discriminator.
type Envelope struct {
	Type string `json:"type"`
}

// ICEServer matches browser RTCIceServer and pion ICEServer shapes.
// Relay deliveries always include STUN alongside TURN.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// Register binds one host connection to one room code.
type Register struct {
	Type             string `json:"type" tstype:"'register'"`
	RoomCode         string `json:"roomCode"`
	InstallationKey  string `json:"installationKey"`
	ApprovalRequired bool   `json:"approvalRequired"`
}

// NormalizedRoomCode folds the claimed code to its lookup form.
func (m Register) NormalizedRoomCode() string {
	return roomcode.Normalize(m.RoomCode)
}

// Registered confirms the durable claim and delivers the ICE bundle.
type Registered struct {
	Type       string      `json:"type" tstype:"'registered'"`
	RoomCode   string      `json:"roomCode"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Conflict tells a registering host its desired code lost.
type Conflict struct {
	Type   string `json:"type" tstype:"'conflict'"`
	Reason string `json:"reason"`
}

// Join covers both directions of the join flow under one type. The phone
// sends roomCode plus displayName, plus a fresh SDP offer in the offer
// field in open mode and offer-less in approval mode, plus the stored
// reconnect id on rejoin. The relay forwards it with a fresh relay-assigned
// correlationId; the host never correlates by connection identity.
type Join struct {
	Type          string `json:"type" tstype:"'join'"`
	RoomCode      string `json:"roomCode,omitempty"`
	PendingID     string `json:"pendingId,omitempty"`
	CorrelationID string `json:"correlationId,omitempty"`
	DisplayName   string `json:"displayName,omitempty"`
	ReconnectID   string `json:"reconnectId,omitempty"`
	Offer         string `json:"offer,omitempty"`
}

// NormalizedRoomCode folds the join code to its lookup form.
func (m Join) NormalizedRoomCode() string {
	return roomcode.Normalize(m.RoomCode)
}

// Joined answers an open-mode phone with the SDP answer plus ICE servers.
type Joined struct {
	Type       string      `json:"type" tstype:"'joined'"`
	Answer     string      `json:"answer"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Pending covers both directions under one type. A pending lives exactly
// while the guest stays connected.
type Pending struct {
	Type        string `json:"type" tstype:"'pending'"`
	PendingID   string `json:"pendingId"`
	DisplayName string `json:"displayName,omitempty"`
	ReconnectID string `json:"reconnectId,omitempty"`
	// WaitingSince is millis since the Unix epoch, set by the relay.
	WaitingSince int64 `json:"waitingSince,omitempty"`
}

// Accepted releases an approval-mode phone to offer.
type Accepted struct {
	Type       string      `json:"type" tstype:"'accepted'"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Offer carries a post-accept SDP offer in its sdp field.
type Offer struct {
	Type          string `json:"type" tstype:"'offer'"`
	PendingID     string `json:"pendingId,omitempty"`
	CorrelationID string `json:"correlationId,omitempty"`
	SDP           string `json:"sdp"`
}

// Answer carries an SDP answer. It correlates by the echoed correlationId.
type Answer struct {
	Type          string `json:"type" tstype:"'answer'"`
	CorrelationID string `json:"correlationId"`
	SDP           string `json:"sdp"`
}

// Accept continues a queued pending toward slot assignment.
type Accept struct {
	Type      string `json:"type" tstype:"'accept'"`
	PendingID string `json:"pendingId"`
}

// Reject drops a queued pending.
type Reject struct {
	Type      string `json:"type" tstype:"'reject'"`
	PendingID string `json:"pendingId"`
	Reason    string `json:"reason,omitempty"`
}

// Rejected tells the guest its join was declined.
type Rejected struct {
	Type   string `json:"type" tstype:"'rejected'"`
	Reason string `json:"reason,omitempty"`
}

// ErrorMessage is the generic failure envelope toward the guest.
type ErrorMessage struct {
	Type    string `json:"type" tstype:"'error'"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// PeerLeft is pre-establishment only.
type PeerLeft struct {
	Type      string `json:"type" tstype:"'peer.left'"`
	PendingID string `json:"pendingId"`
}

// MessageType returns the discriminator of one signaling frame.
func MessageType(data []byte) (string, error) {
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", fmt.Errorf("decode signaling message: %w", err)
	}
	if envelope.Type == "" {
		return "", fmt.Errorf("signaling message type is required")
	}
	return envelope.Type, nil
}

// RoomNotFoundError builds the generic dead-code error.
func RoomNotFoundError() ErrorMessage {
	return ErrorMessage{
		Type:    MessageError,
		Code:    ErrorRoomNotFound,
		Message: "Room not found or host offline",
	}
}

// PendingGoneError reports an accept/reject for an evaporated pending.
func PendingGoneError() ErrorMessage {
	return ErrorMessage{
		Type:    MessageError,
		Code:    ErrorPendingGone,
		Message: "Join request is gone",
	}
}
