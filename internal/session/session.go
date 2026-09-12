package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

// DefaultGracePeriod reserves a disconnected player's slot while a transient
// client blip resolves. The host can override it per session.
const DefaultGracePeriod = 5 * time.Second

var (
	ErrInvalidCode      = errors.New("invalid session code")
	ErrJoinsClosed      = errors.New("session is not accepting new joins")
	ErrSessionFull      = errors.New("session is full")
	ErrInvalidReconnect = errors.New("reconnect id is invalid or expired")
	ErrPlayerNotFound   = errors.New("player not found")
	ErrGeneration       = errors.New("connection generation is no longer current")
	ErrTargetOccupied   = errors.New("target slot is occupied")
	ErrApprovalPending  = errors.New("join is pending approval")
	ErrPendingNotFound  = errors.New("pending join not found")
	ErrRoomNotFound     = errors.New("room not found or host offline")
	ErrDeclined         = errors.New("the host declined your join")
)

type Admission struct {
	Player      PlayerSnapshot
	Reconnected bool
	// PendingID is non-empty when the join queued for approval instead of
	// admitting. The caller waits on PendingWait for the accept/reject
	// outcome; Player is empty until accept.
	PendingID   string
	PendingWait <-chan PendingOutcome
}

// PendingOutcome is the async result of one queued approval join. Accept
// carries the new Admission; reject/evaporate carries ErrDeclined or
// ErrPendingNotFound with an optional human reason.
type PendingOutcome struct {
	Admission Admission
	Err       error
	Reason    string
}

// Pending is one approval-gated join waiting on the host. It holds no
// slot, no device, and no streaming; AcceptPending promotes it to a
// player, RejectPending/RemovePending evaporates it. Send/Close become
// the accepted player's transport callbacks.
type Pending struct {
	ID             string
	DisplayName    string
	fallbackName   bool
	ReconnectID    string
	SelectedLayout string
	WaitingSince   time.Time
	Send           func(any) error
	Close          func()
	wait           chan PendingOutcome
}

// PendingSnapshot is the dashboard queue row: name plus waiting time.
type PendingSnapshot struct {
	ID           string    `json:"id"`
	DisplayName  string    `json:"displayName"`
	WaitingSince time.Time `json:"waitingSince"`
}

type Event struct {
	Type    string
	Player  *PlayerSnapshot
	Message string
}

type Session struct {
	lifecycleMu      sync.Mutex
	mu               sync.RWMutex
	code             string
	codeRequired     bool
	acceptingJoins   bool
	approvalRequired bool
	players          map[string]*Player
	pendings         map[string]*Pending
	slots            [MaxPlayers]*Player
	layouts          *layout.Library
	defaultLayout    string
	devices          *device.Manager
	gracePeriod      time.Duration
	listeners        []func(Event)
}

func New(layouts *layout.Library, devices *device.Manager, gracePeriod time.Duration) (*Session, error) {
	if layouts == nil || devices == nil {
		return nil, errors.New("session requires layout library and device manager")
	}
	code, err := newCode()
	if err != nil {
		return nil, err
	}
	if gracePeriod <= 0 {
		gracePeriod = DefaultGracePeriod
	}
	return &Session{code: code, codeRequired: true, acceptingJoins: true, players: make(map[string]*Player), pendings: make(map[string]*Pending), layouts: layouts, defaultLayout: layouts.Default().ID, devices: devices, gracePeriod: gracePeriod}, nil
}

// newCode generates a room-code-alphabet code so a fresh Session passes
// protocol.DecodeHello before app.New overwrites it with the persistent
// config room code. NewSession never rotates; the code lives in config.
func newCode() (string, error) {
	return roomcode.Generate()
}

func newID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (s *Session) Code() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.code
}

func (s *Session) AcceptingJoins() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.acceptingJoins
}

func (s *Session) SetAcceptingJoins(value bool) {
	s.mu.Lock()
	s.acceptingJoins = value
	s.mu.Unlock()
	s.emit(Event{Type: "joins"})
}

// SetCodeRequired(false) lets clients admit with an empty session code,
// trading the LAN room guard for a frictionless drop-in join.
func (s *Session) SetCodeRequired(value bool) {
	s.mu.Lock()
	s.codeRequired = value
	s.mu.Unlock()
}

// SetCode installs the persistent config room code. app.New calls this
// right after New so the random boot code never serves a join.
func (s *Session) SetCode(code string) {
	s.mu.Lock()
	s.code = roomcode.Normalize(code)
	s.mu.Unlock()
}

// SetApprovalRequired toggles the admission gate. Off (default) admits
// immediately; on parks new joins as pendings until AcceptPending.
func (s *Session) SetApprovalRequired(value bool) {
	s.mu.Lock()
	s.approvalRequired = value
	s.mu.Unlock()
	s.emit(Event{Type: "settings"})
}

func (s *Session) ApprovalRequired() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.approvalRequired
}

// Pendings lists queued approval joins oldest-first for the dashboard.
func (s *Session) Pendings() []PendingSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]PendingSnapshot, 0, len(s.pendings))
	for _, pending := range s.pendings {
		out = append(out, PendingSnapshot{ID: pending.ID, DisplayName: pending.DisplayName, WaitingSince: pending.WaitingSince})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].WaitingSince.Before(out[j].WaitingSince) })
	return out
}

// CheckCode validates a room code without admitting. The RTC
// control-channel hello calls this: admit already happened at
// join-forward (open) or accept (approval), so hello must never mint a
// second player.
func (s *Session) CheckCode(sessionCode string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.codeRequired && roomcode.Normalize(sessionCode) != roomcode.Normalize(s.code) {
		return ErrInvalidCode
	}
	return nil
}

func (s *Session) Subscribe(listener func(Event)) func() {
	s.mu.Lock()
	s.listeners = append(s.listeners, listener)
	index := len(s.listeners) - 1
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		if index < len(s.listeners) {
			s.listeners[index] = nil
			for len(s.listeners) > 0 && s.listeners[len(s.listeners)-1] == nil {
				s.listeners = s.listeners[:len(s.listeners)-1]
			}
		}
		s.mu.Unlock()
	}
}

// Admit holds lifecycleMu for the whole call so two concurrent admits cannot
// pick the same slot, but only holds s.mu for short sections. Device creation
// does kernel I/O, so snapshot readers stay available while lifecycle work waits.
func (s *Session) Admit(sessionCode, displayName, reconnectID, selectedLayout string, send func(any) error, close func()) (Admission, error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	// Both sides normalize: the wire accepts folded input (lowercase,
	// dashes, spaces per DecodeHello) and hand-edited configs may hold it.
	if s.codeRequired && roomcode.Normalize(sessionCode) != roomcode.Normalize(s.code) {
		s.mu.Unlock()
		return Admission{}, ErrInvalidCode
	}
	if reconnectID != "" {
		var matched *Player
		for _, player := range s.players {
			if player.ReconnectID == reconnectID {
				matched = player
				break
			}
		}
		if matched != nil && matched.State == StateDisconnectedGrace {
			matched.Generation++
			matched.State = StateActive
			matched.GraceDeadline = time.Time{}
			matched.Send = send
			matched.Close = close
			matched.HasSequence = false
			matched.LastSequence = 0
			snapshot := matched.Snapshot()
			slot := matched.Slot
			s.mu.Unlock()
			if err := s.devices.Neutralize(slot); err != nil {
				log.Printf("player %s slot %d failed to neutralize on reconnect: %v", matched.ID, slot, err)
			}
			log.Printf("player %s slot %d reconnected", matched.ID, slot)
			s.emit(Event{Type: "player.reconnected", Player: &snapshot})
			return Admission{Player: snapshot, Reconnected: true}, nil
		}
		if matched != nil {
			log.Printf("stale reconnect %s state=%s, joining as new player", reconnectID, matched.State)
		} else {
			log.Printf("expired reconnect %s, joining as new player", reconnectID)
		}
	}
	if !s.acceptingJoins {
		s.mu.Unlock()
		return Admission{}, ErrJoinsClosed
	}
	slot := firstFree(s.slots)
	if slot < 0 {
		s.mu.Unlock()
		return Admission{}, ErrSessionFull
	}
	// Approval gate: reclaim already returned above and skips re-approval.
	// Expired/stale reconnect IDs fall through and queue as new. Shipment 1
	// leaves the toggle off so this branch never runs until the dashboard
	// ships it; the /ws caller handles ErrApprovalPending without closing.
	if s.approvalRequired {
		id, err := newID()
		if err != nil {
			s.mu.Unlock()
			return Admission{}, fmt.Errorf("generate pending id: %w", err)
		}
		for {
			if _, exists := s.pendings[id]; !exists {
				break
			}
			id, err = newID()
			if err != nil {
				s.mu.Unlock()
				return Admission{}, fmt.Errorf("generate pending id: %w", err)
			}
		}
		name := strings.TrimSpace(displayName)
		if runes := []rune(name); len(runes) > 40 {
			name = string(runes[:40])
		}
		fallback := false
		if name == "" {
			name = "Player"
			fallback = true
		}
		pending := &Pending{
			ID: id, DisplayName: name, fallbackName: fallback, ReconnectID: reconnectID,
			SelectedLayout: selectedLayout, WaitingSince: time.Now(),
			Send: send, Close: close, wait: make(chan PendingOutcome, 1),
		}
		s.pendings[id] = pending
		wait := pending.wait
		s.mu.Unlock()
		log.Printf("pending %s queued display=%q", id, name)
		s.emit(Event{Type: "pending.joined", Message: id})
		return Admission{PendingID: id, PendingWait: wait}, ErrApprovalPending
	}
	id, err := newID()
	if err != nil {
		s.mu.Unlock()
		return Admission{}, fmt.Errorf("generate player id: %w", err)
	}
	reconnect, err := newID()
	if err != nil {
		s.mu.Unlock()
		return Admission{}, fmt.Errorf("generate reconnect id: %w", err)
	}
	if selectedLayout == "" {
		selectedLayout = s.defaultLayout
	}
	if _, ok := s.layouts.Get(selectedLayout); !ok {
		selectedLayout = s.defaultLayout
	}
	name := strings.TrimSpace(displayName)
	if runes := []rune(name); len(runes) > 40 {
		name = string(runes[:40])
	}
	if name == "" {
		name = fmt.Sprintf("Player %d", slot+1)
	}
	player := &Player{ID: id, Slot: slot, Name: name, Accent: slotAccents[slot], State: StateActive, LayoutID: selectedLayout, Generation: 1, ReconnectID: reconnect, Send: send, Close: close}
	playerID := player.ID
	s.mu.Unlock()
	if err := s.devices.Create(slot, func(strong, weak uint16) { s.dispatchRumble(playerID, strong, weak) }); err != nil {
		return Admission{}, fmt.Errorf("create virtual device for slot %d: %w", slot, err)
	}
	s.mu.Lock()
	s.players[player.ID] = player
	s.slots[slot] = player
	snapshot := player.Snapshot()
	s.mu.Unlock()
	log.Printf("player %s slot %d joined display=%q", player.ID, slot, name)
	s.emit(Event{Type: "player.joined", Player: &snapshot})
	return Admission{Player: snapshot}, nil
}

// AcceptPending promotes one queued join to a player: slot assign plus
// device create, holding the same lifecycleMu-then-state order as Admit so
// apply-after-destroy is impossible. It returns the Admission for the
// caller to build the welcome; a /ws waiter also receives it on the
// pending channel. A full session keeps the pending queued for retry.
func (s *Session) AcceptPending(id string) (Admission, error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	pending, ok := s.pendings[id]
	if !ok {
		s.mu.Unlock()
		return Admission{}, ErrPendingNotFound
	}
	slot := firstFree(s.slots)
	if slot < 0 {
		s.mu.Unlock()
		return Admission{}, ErrSessionFull
	}
	playerID, err := newID()
	if err != nil {
		s.mu.Unlock()
		return Admission{}, fmt.Errorf("generate player id: %w", err)
	}
	reconnect, err := newID()
	if err != nil {
		s.mu.Unlock()
		return Admission{}, fmt.Errorf("generate reconnect id: %w", err)
	}
	selectedLayout := pending.SelectedLayout
	if selectedLayout == "" {
		selectedLayout = s.defaultLayout
	}
	if _, ok := s.layouts.Get(selectedLayout); !ok {
		selectedLayout = s.defaultLayout
	}
	name := pending.DisplayName
	if pending.fallbackName {
		name = fmt.Sprintf("Player %d", slot+1)
	}
	player := &Player{ID: playerID, Slot: slot, Name: name, Accent: slotAccents[slot], State: StateActive, LayoutID: selectedLayout, Generation: 1, ReconnectID: reconnect, Send: pending.Send, Close: pending.Close}
	wait := pending.wait
	s.mu.Unlock()
	if err := s.devices.Create(slot, func(strong, weak uint16) { s.dispatchRumble(playerID, strong, weak) }); err != nil {
		return Admission{}, fmt.Errorf("create virtual device for slot %d: %w", slot, err)
	}
	s.mu.Lock()
	if _, ok := s.pendings[id]; !ok {
		s.mu.Unlock()
		_ = s.devices.Destroy(slot)
		return Admission{}, ErrPendingNotFound
	}
	delete(s.pendings, id)
	s.players[player.ID] = player
	s.slots[slot] = player
	snapshot := player.Snapshot()
	s.mu.Unlock()
	admission := Admission{Player: snapshot}
	select {
	case wait <- PendingOutcome{Admission: admission}:
	default:
	}
	log.Printf("pending %s accepted as player %s slot %d", id, player.ID, slot)
	s.emit(Event{Type: "player.joined", Player: &snapshot})
	s.emit(Event{Type: "pending.accepted", Player: &snapshot, Message: id})
	return admission, nil
}

// RejectPending drops one queued join. The /ws waiter sends the declined
// wire message itself; the relay path notifies the guest via accept/reject
// on its own socket. Session only evaporates and wakes the waiter.
func (s *Session) RejectPending(id, reason string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	pending, ok := s.pendings[id]
	if !ok {
		s.mu.Unlock()
		return ErrPendingNotFound
	}
	delete(s.pendings, id)
	wait := pending.wait
	s.mu.Unlock()
	select {
	case wait <- PendingOutcome{Err: ErrDeclined, Reason: reason}:
	default:
	}
	log.Printf("pending %s rejected", id)
	s.emit(Event{Type: "pending.rejected", Message: id})
	return nil
}

// RemovePending evaporates one queued join when its guest disconnects.
// No timers: a pending lives exactly while the guest stays connected.
// No-op when the id is already gone (accept/reject won the race).
func (s *Session) RemovePending(id string) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	pending, ok := s.pendings[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.pendings, id)
	wait := pending.wait
	s.mu.Unlock()
	select {
	case wait <- PendingOutcome{Err: ErrPendingNotFound}:
	default:
	}
	s.emit(Event{Type: "pending.left", Message: id})
}

// BuildWelcome renders the pre-built welcome for an admitted player. The
// RTC control-channel hello calls this after CheckCode instead of Admit,
// so one join can never mint two players.
func BuildWelcome(player PlayerSnapshot, layouts *layout.Library, targetInputRate int) protocol.Welcome {
	welcome := protocol.Welcome{Type: protocol.MessageWelcome, PlayerID: player.ID, Slot: player.Slot, DisplayName: player.Name, Accent: player.Accent, ReconnectID: player.ReconnectID, ProtocolVersion: protocol.Version, FrameSize: protocol.FrameSize, TargetInputRate: targetInputRate, SelectedLayout: player.LayoutID}
	welcome.AvailableLayouts = make([]protocol.LayoutSummary, 0)
	for _, summary := range layouts.Summaries() {
		welcome.AvailableLayouts = append(welcome.AvailableLayouts, protocol.LayoutSummary{ID: summary.ID, Name: summary.Name})
	}
	return welcome
}

// AdmissionError maps session failures to stable wire codes shared by the
// LAN socket and the future WebRTC control channel. Existing codes are
// byte-identical; pending_gone mirrors the relay evaporate signal and
// room_not_found mirrors the relay generic dead-code error.
func AdmissionError(err error) (string, string) {
	switch {
	case errors.Is(err, ErrInvalidCode):
		return "invalid_code", "The session code is invalid."
	case errors.Is(err, ErrRoomNotFound):
		return "room_not_found", "Room not found or host offline."
	case errors.Is(err, ErrApprovalPending):
		return "pending", "Waiting for host approval."
	case errors.Is(err, ErrPendingNotFound):
		return "pending_gone", "Join request is gone."
	case errors.Is(err, ErrDeclined):
		return "declined", "The host declined your join."
	case errors.Is(err, ErrJoinsClosed):
		return "joins_closed", "This session is not accepting new joins."
	case errors.Is(err, ErrSessionFull):
		return "session_full", fmt.Sprintf("This session already has %d players.", MaxPlayers)
	case errors.Is(err, ErrInvalidReconnect):
		return "invalid_reconnect", "The reconnect window has expired. Join as a new player."
	default:
		return "device_error", "The host could not create your virtual controller."
	}
}

func (s *Session) dispatchRumble(id string, strong, weak uint16) {
	s.mu.RLock()
	player := s.players[id]
	var send func(any) error
	if player != nil {
		send = player.Send
	}
	s.mu.RUnlock()
	if send == nil {
		return
	}
	_ = send(protocol.Rumble{Type: protocol.MessageRumble, Strong: strong, Weak: weak, Active: strong != 0 || weak != 0})
}

func (s *Session) Player(id string) (PlayerSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	player, ok := s.players[id]
	if !ok {
		return PlayerSnapshot{}, false
	}
	return player.Snapshot(), true
}

func (s *Session) snapshotByID(id string) *PlayerSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	player := s.players[id]
	if player == nil {
		return nil
	}
	snapshot := player.Snapshot()
	return &snapshot
}

func (s *Session) Players() []PlayerSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]PlayerSnapshot, 0, len(s.players))
	for _, player := range s.players {
		out = append(out, player.Snapshot())
	}
	return out
}

func (s *Session) AcceptSequence(id string, generation uint64, sequence uint32) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	player := s.players[id]
	if player == nil {
		return false, ErrPlayerNotFound
	}
	if player.Generation != generation {
		return false, ErrGeneration
	}
	if player.HasSequence && !protocol.IsNewerSequence(sequence, player.LastSequence) {
		return false, nil
	}
	player.LastSequence = sequence
	player.HasSequence = true
	return true, nil
}

func (s *Session) ApplyInput(id string, generation uint64, frame protocol.Frame) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if player.Generation != generation {
		s.mu.Unlock()
		return ErrGeneration
	}
	if player.State == StateDeviceError {
		s.mu.Unlock()
		return errors.New("player device is unavailable")
	}
	wasStale := player.State == StateStale
	slot := player.Slot
	s.mu.Unlock()
	if err := s.devices.Apply(slot, uinput.State{Buttons: frame.Buttons, LX: frame.LX, LY: frame.LY, RX: frame.RX, RY: frame.RY, LT: frame.LT, RT: frame.RT}); err != nil {
		return err
	}

	s.mu.Lock()
	player = s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if player.Generation != generation {
		s.mu.Unlock()
		return ErrGeneration
	}
	player.State = StateActive
	now := time.Now()
	player.lastFrame = now
	if !frame.IsNeutral() {
		player.LastInput = now
	}
	s.mu.Unlock()
	if wasStale {
		log.Printf("player %s slot %d recovered from stale", id, slot)
	}
	return nil
}

func (s *Session) MarkStale(id string, generation uint64) error {
	return s.markStale(id, generation, 0)
}

func (s *Session) MarkStaleIfIdle(id string, generation uint64, idle time.Duration) error {
	return s.markStale(id, generation, idle)
}

func (s *Session) markStale(id string, generation uint64, idle time.Duration) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if player.Generation != generation {
		s.mu.Unlock()
		return ErrGeneration
	}
	if idle > 0 && !player.lastFrame.IsZero() && time.Since(player.lastFrame) < idle {
		s.mu.Unlock()
		return nil
	}
	wasActive := player.State == StateActive
	if wasActive {
		player.State = StateStale
	}
	slot := player.Slot
	s.mu.Unlock()
	if err := s.devices.Neutralize(slot); err != nil {
		return err
	}
	if wasActive {
		log.Printf("player %s slot %d marked stale", id, slot)
		s.emit(Event{Type: "player.stale", Player: s.snapshotByID(id)})
	}
	return nil
}

func (s *Session) Disconnect(id string, generation uint64) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if player.Generation != generation {
		s.mu.Unlock()
		return ErrGeneration
	}
	player.Generation++
	generation = player.Generation
	grace := s.gracePeriod
	player.State = StateDisconnectedGrace
	player.GraceDeadline = time.Now().Add(grace)
	player.Send = nil
	player.Close = nil
	slot := player.Slot
	s.mu.Unlock()
	if err := s.devices.Neutralize(slot); err != nil {
		log.Printf("player %s slot %d failed to neutralize on disconnect: %v", id, slot, err)
	}
	log.Printf("player %s slot %d disconnected grace=%s", id, slot, grace)
	s.emit(Event{Type: "player.disconnected", Player: s.snapshotByID(id)})
	time.AfterFunc(grace, func() { s.expireGrace(id, generation) })
	return nil
}

func (s *Session) expireGrace(id string, generation uint64) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	player := s.players[id]
	if player == nil || player.Generation != generation || player.State != StateDisconnectedGrace {
		s.mu.Unlock()
		return
	}
	slot := player.Slot
	delete(s.players, id)
	s.slots[slot] = nil
	s.mu.Unlock()
	if err := s.devices.Destroy(slot); err != nil {
		log.Printf("player %s slot %d failed to destroy expired device: %v", id, slot, err)
	}
	log.Printf("player %s slot %d expired", id, slot)
	s.emit(Event{Type: "player.expired", Message: id})
}

func (s *Session) Leave(id string, generation uint64) error {
	return s.closePlayer(id, generation, "leave")
}

// Kick frees the slot immediately even if the socket close races ahead and
// puts the player into reconnect grace first, hence generation 0 (any).
func (s *Session) Kick(id string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.RLock()
	player := s.players[id]
	var send func(any) error
	if player != nil {
		send = player.Send
	}
	s.mu.RUnlock()
	if player == nil {
		return nil
	}
	if send != nil {
		_ = send(protocol.CloseMessage{Type: protocol.MessageClose, Reason: "kicked"})
	}
	return s.closePlayerLocked(id, 0, "kick")
}

func (s *Session) closePlayer(id string, generation uint64, reason string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	return s.closePlayerLocked(id, generation, reason)
}

func (s *Session) closePlayerLocked(id string, generation uint64, reason string) error {
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if generation != 0 && player.Generation != generation {
		s.mu.Unlock()
		return ErrGeneration
	}
	slot := player.Slot
	close := player.Close
	delete(s.players, id)
	s.slots[slot] = nil
	s.mu.Unlock()
	if close != nil {
		close()
	}
	if err := s.devices.Destroy(slot); err != nil {
		return err
	}
	log.Printf("player %s slot %d %s", id, slot, reason)
	s.emit(Event{Type: "player.closed", Message: reason})
	return nil
}

func (s *Session) Move(id string, target int) error {
	if target < 0 || target >= MaxPlayers {
		return fmt.Errorf("target slot must be between 0 and %d", MaxPlayers-1)
	}
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	if s.slots[target] != nil {
		s.mu.Unlock()
		return ErrTargetOccupied
	}
	old := player.Slot
	generation := player.Generation
	rumble := func(strong, weak uint16) { s.dispatchRumble(id, strong, weak) }
	s.mu.Unlock()
	// Destroy already neutralizes; Manager.Destroy is the single teardown path.
	if err := s.devices.Destroy(old); err != nil {
		if recreateErr := s.devices.Create(old, rumble); recreateErr != nil {
			s.mu.Lock()
			if current := s.players[id]; current != nil {
				current.State = StateDeviceError
				current.DeviceReason = err.Error()
			}
			s.mu.Unlock()
			return fmt.Errorf("move failed: %w; rollback failed: %v", err, recreateErr)
		}
		return err
	}
	if err := s.devices.Create(target, rumble); err != nil {
		if recreateErr := s.devices.Create(old, rumble); recreateErr != nil {
			s.mu.Lock()
			if current := s.players[id]; current != nil {
				current.State = StateDeviceError
				current.DeviceReason = err.Error()
			}
			s.mu.Unlock()
			return fmt.Errorf("move failed: %w; rollback failed: %v", err, recreateErr)
		}
		return err
	}
	s.mu.Lock()
	current := s.players[id]
	if current == nil || current.Generation != generation {
		s.mu.Unlock()
		_ = s.devices.Destroy(target)
		return ErrGeneration
	}
	s.slots[old] = nil
	s.slots[target] = current
	accent := slotAccents[target]
	current.Slot = target
	current.Accent = accent
	current.State = StateActive
	send := current.Send
	s.mu.Unlock()
	log.Printf("player %s moved %d -> %d", id, old, target)
	if send != nil {
		_ = send(protocol.SlotUpdate{Type: protocol.MessageSlotUpdate, Slot: target, Accent: accent})
	}
	s.emit(Event{Type: "player.moved", Player: s.snapshotByID(id)})
	return nil
}

func (s *Session) SetLayout(id, layoutID string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	document, ok := s.layouts.Get(layoutID)
	if !ok {
		return fmt.Errorf("layout %q is not available", layoutID)
	}
	s.mu.Lock()
	player := s.players[id]
	if player == nil {
		s.mu.Unlock()
		return ErrPlayerNotFound
	}
	player.LayoutID = layoutID
	send := player.Send
	s.mu.Unlock()
	if send != nil {
		_ = send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: document.ID, Layout: document})
	}
	s.emit(Event{Type: "player.layout", Player: s.snapshotByID(id)})
	return nil
}

func (s *Session) SetDefaultLayout(layoutID string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if _, ok := s.layouts.Get(layoutID); !ok {
		return fmt.Errorf("layout %q is not available", layoutID)
	}
	s.mu.Lock()
	s.defaultLayout = layoutID
	s.mu.Unlock()
	s.emit(Event{Type: "settings"})
	return nil
}

// SetGracePeriod changes the reconnect grace window for the running session.
// It affects players who disconnect after the update, not in-flight deadlines.
func (s *Session) SetGracePeriod(gracePeriod time.Duration) {
	if gracePeriod <= 0 {
		return
	}
	s.mu.Lock()
	s.gracePeriod = gracePeriod
	s.mu.Unlock()
	s.emit(Event{Type: "settings"})
}

func (s *Session) ReconcileLayouts() {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.RLock()
	defaultID := s.defaultLayout
	s.mu.RUnlock()
	defaultDoc, ok := s.layouts.Get(defaultID)
	if !ok {
		defaultDoc = s.layouts.Default()
		defaultID = defaultDoc.ID
	}
	s.mu.Lock()
	affected := 0
	var sends []func(any) error
	for _, player := range s.players {
		if _, ok := s.layouts.Get(player.LayoutID); !ok {
			affected++
			player.LayoutID = defaultID
			if player.Send != nil {
				sends = append(sends, player.Send)
			}
		}
	}
	s.mu.Unlock()
	for _, send := range sends {
		_ = send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: defaultDoc.ID, Layout: defaultDoc})
	}
	if affected > 0 {
		s.emit(Event{Type: "player.layout"})
	}
}

// PushLayoutUpdate sends the fresh document to every player currently using
// layoutID. Call it after a dashboard edit saves so phones render the new
// geometry without reselecting the layout.
func (s *Session) PushLayoutUpdate(layoutID string) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	document, ok := s.layouts.Get(layoutID)
	if !ok {
		return
	}
	s.mu.RLock()
	var sends []func(any) error
	for _, player := range s.players {
		if player.LayoutID == layoutID && player.Send != nil {
			sends = append(sends, player.Send)
		}
	}
	s.mu.RUnlock()
	for _, send := range sends {
		_ = send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: document.ID, Layout: document})
	}
}

// PushAllLayouts sends each player its current document. Used after a library
// reload where any file may have changed; ReconcileLayouts only covers
// deleted IDs, this covers edited content for existing IDs.
func (s *Session) PushAllLayouts() {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.RLock()
	defaultID := s.defaultLayout
	type pending struct {
		send func(any) error
		doc  layout.Document
	}
	var sends []pending
	for _, player := range s.players {
		if player.Send == nil {
			continue
		}
		doc, ok := s.layouts.Get(player.LayoutID)
		if !ok {
			doc, ok = s.layouts.Get(defaultID)
		}
		if !ok {
			doc = s.layouts.Default()
		}
		sends = append(sends, pending{send: player.Send, doc: doc})
	}
	s.mu.RUnlock()
	for _, p := range sends {
		_ = p.send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: p.doc.ID, Layout: p.doc})
	}
}

func (s *Session) NotifySettings() { s.emit(Event{Type: "settings"}) }

func (s *Session) Layout(id string) (layout.Document, error) {
	s.mu.RLock()
	player := s.players[id]
	layoutID := ""
	if player != nil {
		layoutID = player.LayoutID
	}
	defaultID := s.defaultLayout
	s.mu.RUnlock()
	if player == nil {
		return layout.Document{}, ErrPlayerNotFound
	}
	doc, ok := s.layouts.Get(layoutID)
	if !ok {
		doc, ok = s.layouts.Get(defaultID)
	}
	if !ok {
		return s.layouts.Default(), nil
	}
	return doc, nil
}

func (s *Session) SetPong(id string, generation uint64, rtt time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	player := s.players[id]
	if player == nil {
		return ErrPlayerNotFound
	}
	if player.Generation != generation {
		return ErrGeneration
	}
	player.LastPong = time.Now()
	player.RTT = rtt
	return nil
}

func (s *Session) NewSession() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	players := make([]*Player, 0, len(s.players))
	for _, player := range s.players {
		players = append(players, player)
	}
	pendings := make([]*Pending, 0, len(s.pendings))
	for _, pending := range s.pendings {
		pendings = append(pendings, pending)
	}
	// The room code is persistent host config, not per-process state:
	// rotating it would strand QR codes and self-brick the relay claim.
	// NewSession clears players/devices/slots and pendings only.
	s.acceptingJoins = true
	s.players = make(map[string]*Player)
	s.pendings = make(map[string]*Pending)
	s.slots = [MaxPlayers]*Player{}
	code := s.code
	s.mu.Unlock()
	log.Printf("new session (code %s kept)", code)
	s.emit(Event{Type: "session.reset"})
	for _, pending := range pendings {
		select {
		case pending.wait <- PendingOutcome{Err: ErrPendingNotFound}:
		default:
		}
		s.emit(Event{Type: "pending.left", Message: pending.ID})
	}
	for _, player := range players {
		if player.Close != nil {
			player.Close()
		}
	}
	if err := s.devices.DestroyAll(); err != nil {
		return err
	}
	return nil
}

func (s *Session) Close() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	players := make([]*Player, 0, len(s.players))
	for _, player := range s.players {
		players = append(players, player)
	}
	pendings := make([]*Pending, 0, len(s.pendings))
	for _, pending := range s.pendings {
		pendings = append(pendings, pending)
	}
	s.players = make(map[string]*Player)
	s.pendings = make(map[string]*Pending)
	s.slots = [MaxPlayers]*Player{}
	s.mu.Unlock()
	for _, pending := range pendings {
		select {
		case pending.wait <- PendingOutcome{Err: ErrPendingNotFound}:
		default:
		}
	}
	for _, player := range players {
		if player.Close != nil {
			player.Close()
		}
	}
	return s.devices.DestroyAll()
}

func (s *Session) emit(event Event) {
	s.mu.RLock()
	listeners := append([]func(Event){}, s.listeners...)
	s.mu.RUnlock()
	for _, listener := range listeners {
		if listener != nil {
			listener(event)
		}
	}
}
