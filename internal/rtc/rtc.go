// Package rtc is the Go-canonical shared signaling contract for the v2a
// online path (SPEC Q4/Q5/Q18, PLAN Phase 2).
//
// The relay, the host, and the join page compile the same message types:
// TypeScript is derived via tygo codegen, never hand-duplicated. The
// relay routes by normalized room code, answers correlate by
// relay-assigned correlation id echoed from the forwarded join, never by
// connection identity. Unknown, retired, and offline-host codes all
// produce one generic error so the relay exposes no enumeration oracle.
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
// retired, and offline-host codes: one relay path, no enumeration oracle.
// PendingGone reports an accept/reject for a pending that already
// evaporated (guest signaling socket dropped); the host no-ops and
// reconciles via admin state.
const (
	ErrorRoomNotFound = "room_not_found"
	ErrorPendingGone  = "pending_gone"
)

// Envelope carries only the discriminator, mirroring internal/protocol.
type Envelope struct {
	Type string `json:"type"`
}

// ICEServer matches browser RTCIceServer and pion ICEServer shapes.
// Relay deliveries always include STUN alongside TURN: without STUN the
// phone gathers no srflx candidates and every open-mode join silently
// degrades to relayed.
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// Register binds one host connection to one room code. The installation
// key proves ownership of the durable claim and is never logged.
type Register struct {
	Type             string `json:"type" tstype:"'register'"`
	RoomCode         string `json:"roomCode"`
	InstallationKey  string `json:"installationKey"`
	ApprovalRequired bool   `json:"approvalRequired"`
}

// NormalizedRoomCode folds the claimed code to its lookup form before any
// durable lookup or claim comparison.
func (m Register) NormalizedRoomCode() string {
	return roomcode.Normalize(m.RoomCode)
}

// Registered confirms the durable claim and delivers the TURN credential
// bundle (STUN + TURN, 24h TTL, no refresh flow).
type Registered struct {
	Type       string      `json:"type" tstype:"'registered'"`
	RoomCode   string      `json:"roomCode"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Conflict tells a registering host its desired code is claimed or retired
// under another installation key. LAN keeps serving the local code;
// remote stays dark until the owner resolves via the dashboard.
type Conflict struct {
	Type   string `json:"type" tstype:"'conflict'"`
	Reason string `json:"reason"`
}

// Join covers both directions of the join flow under one type. The phone
// sends roomCode plus displayName (plus a fresh SDP offer in the `offer`
// field in open mode, offer-less in approval mode, plus the stored
// sends roomCode plus displayName (plus a fresh SDP offer in open mode,
// offer-less in approval mode, plus the stored reconnect id on rejoin).
// The relay forwards it to the host with a fresh relay-assigned
// correlationId (and the approval pendingId once queued); the host never
// correlates by connection identity because one guest socket can carry
// several join flows across rejects.
type Join struct {
	Type          string `json:"type" tstype:"'join'"`
	RoomCode      string `json:"roomCode,omitempty"`
	PendingID     string `json:"pendingId,omitempty"`
	CorrelationID string `json:"correlationId,omitempty"`
	DisplayName   string `json:"displayName,omitempty"`
	ReconnectID   string `json:"reconnectId,omitempty"`
	Offer         string `json:"offer,omitempty"`
}

// NormalizedRoomCode folds the join code to its lookup form before routing.
func (m Join) NormalizedRoomCode() string {
	return roomcode.Normalize(m.RoomCode)
}

// Joined answers an open-mode phone: the SDP answer plus the iceServer
// bundle (arrives post-offer, so it serves spec symmetry and approval
// mode, never an open-mode re-gather).
type Joined struct {
	Type       string      `json:"type" tstype:"'joined'"`
	Answer     string      `json:"answer"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Pending covers both directions under one type. The relay sends the full
// entry to the host (queue display) and the bare id to the waiting guest.
// A pending lives exactly while the guest stays connected; socket close
// evaporates it, no expiry timers.
type Pending struct {
	Type        string `json:"type" tstype:"'pending'"`
	PendingID   string `json:"pendingId"`
	DisplayName string `json:"displayName,omitempty"`
	ReconnectID string `json:"reconnectId,omitempty"`
	// WaitingSince is millis since the Unix epoch, set by the relay.
	WaitingSince int64 `json:"waitingSince,omitempty"`
}

// Accepted releases an approval-mode phone to offer: it carries the
// iceServer bundle the open-mode phone already had at construction, so
// the post-accept offer gathers with TURN from the start.
type Accepted struct {
	Type       string      `json:"type" tstype:"'accepted'"`
	ICEServers []ICEServer `json:"iceServers"`
}

// Offer carries a post-accept SDP offer in its `sdp` field (contrast
// Join.Offer, which carries the open-mode offer under the `offer` key).
// The guest sends bare SDP; the
// relay forwards it with the approval pendingId and a fresh
// relay-assigned correlationId the host echoes on its answer.
type Offer struct {
	Type          string `json:"type" tstype:"'offer'"`
	PendingID     string `json:"pendingId,omitempty"`
	CorrelationID string `json:"correlationId,omitempty"`
	SDP           string `json:"sdp"`
}

// Answer carries an SDP answer in its `sdp` field (contrast
// Joined.Answer, which carries the open-mode answer under the `answer`
// key). It correlates by the echoed correlationId
// from the forwarded join or offer, never by connection.
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

// Reject drops a queued pending. The guest returns to the join screen with
// a declined message and may immediately re-request on the same socket.
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

// ErrorMessage is the single generic failure envelope toward the guest.
type ErrorMessage struct {
	Type    string `json:"type" tstype:"'error'"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// PeerLeft is scoped to pre-establishment only: a pending guest whose host
// connection drops before signaling completes. After establishment the
// host PeerConnection state is authoritative and no peer.left exists.
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

// RoomNotFoundError builds the generic dead-code error. It takes no cause
// so unknown, retired, and offline-host codes serialize byte-identically.
func RoomNotFoundError() ErrorMessage {
	return ErrorMessage{
		Type:    MessageError,
		Code:    ErrorRoomNotFound,
		Message: "Room not found or host offline",
	}
}

// PendingGoneError reports an accept/reject for an evaporated pending.
// The host treats it as a no-op and reconciles via admin state.
func PendingGoneError() ErrorMessage {
	return ErrorMessage{
		Type:    MessageError,
		Code:    ErrorPendingGone,
		Message: "Join request is gone",
	}
}
