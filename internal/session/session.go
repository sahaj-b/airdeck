package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
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
)

type Admission struct {
	Player      PlayerSnapshot
	Reconnected bool
}

type Event struct {
	Type    string
	Player  *PlayerSnapshot
	Message string
}

type Session struct {
	lifecycleMu    sync.Mutex
	mu             sync.RWMutex
	code           string
	codeRequired   bool
	acceptingJoins bool
	players        map[string]*Player
	slots          [maxPlayers]*Player
	layouts        *layout.Library
	defaultLayout  string
	devices        *device.Manager
	gracePeriod    time.Duration
	listeners      []func(Event)
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
	return &Session{code: code, codeRequired: true, acceptingJoins: true, players: make(map[string]*Player), layouts: layouts, defaultLayout: layouts.Default().ID, devices: devices, gracePeriod: gracePeriod}, nil
}

func newCode() (string, error) {
	for {
		var bytes [2]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return "", fmt.Errorf("generate session code: %w", err)
		}
		value := uint16(bytes[0])<<8 | uint16(bytes[1])
		if value >= 60000 {
			continue
		}
		return fmt.Sprintf("%04d", value%10000), nil
	}
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

func (s *Session) Subscribe(listener func(Event)) func() {
	s.mu.Lock()
	s.listeners = append(s.listeners, listener)
	index := len(s.listeners) - 1
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		if index < len(s.listeners) {
			s.listeners[index] = nil
			// Compact trailing nils so the slice does not grow without bound
			// across many dashboard reconnects.
			for len(s.listeners) > 0 && s.listeners[len(s.listeners)-1] == nil {
				s.listeners = s.listeners[:len(s.listeners)-1]
			}
		}
		s.mu.Unlock()
	}
}

func (s *Session) Admit(sessionCode, displayName, reconnectID, selectedLayout string, send func(any) error, close func()) (Admission, error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	s.mu.Lock()
	if s.codeRequired && sessionCode != s.code {
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
			_ = s.devices.Neutralize(slot)
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
	player := &Player{ID: id, Slot: slot, Name: name, Accent: slotAccents[slot], State: StateJoining, LayoutID: selectedLayout, Generation: 1, ReconnectID: reconnect, DeviceStatus: "creating", Send: send, Close: close}
	playerID := player.ID
	if err := s.devices.Create(slot, func(strong, weak uint16) { s.dispatchRumble(playerID, strong, weak) }); err != nil {
		s.mu.Unlock()
		// The seat stays free: the join is rejected with a machine-readable
		// device_error message and no roster entry, so a failed creation
		// cannot burn a seat.
		return Admission{}, fmt.Errorf("create virtual device for slot %d: %w", slot, err)
	}
	player.State = StateActive
	player.DeviceStatus = "ready"
	s.players[player.ID] = player
	s.slots[slot] = player
	snapshot := player.Snapshot()
	s.mu.Unlock()
	log.Printf("player %s slot %d joined display=%q", player.ID, slot, name)
	s.emit(Event{Type: "player.joined", Player: &snapshot})
	return Admission{Player: snapshot}, nil
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
	if player.Generation != generation || player.State == StateClosed {
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
	if player.Generation != generation || player.State == StateClosed {
		s.mu.Unlock()
		return ErrGeneration
	}
	if player.State == StateDeviceError {
		s.mu.Unlock()
		return errors.New("player device is unavailable")
	}
	wasStale := player.State == StateStale
	player.State = StateActive
	if !frame.IsNeutral() {
		player.LastInput = time.Now()
	}
	slot := player.Slot
	s.mu.Unlock()
	if wasStale {
		log.Printf("player %s slot %d recovered from stale", id, slot)
	}
	return s.devices.Apply(slot, uinput.State{Buttons: frame.Buttons, LX: frame.LX, LY: frame.LY, RX: frame.RX, RY: frame.RY, LT: frame.LT, RT: frame.RT})
}

func (s *Session) MarkStale(id string, generation uint64) error {
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
	if player.Generation != generation || player.State == StateClosed {
		s.mu.Unlock()
		return ErrGeneration
	}
	player.Generation++
	generation = player.Generation
	player.State = StateDisconnectedGrace
	player.GraceDeadline = time.Now().Add(s.gracePeriod)
	player.Send = nil
	player.Close = nil
	slot := player.Slot
	s.mu.Unlock()
	_ = s.devices.Neutralize(slot)
	log.Printf("player %s slot %d disconnected grace=%s", id, slot, s.gracePeriod)
	s.emit(Event{Type: "player.disconnected", Player: s.snapshotByID(id)})
	time.AfterFunc(s.gracePeriod, func() { s.expireGrace(id, generation) })
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
	player.State = StateClosed
	delete(s.players, id)
	s.slots[slot] = nil
	s.mu.Unlock()
	_ = s.devices.Destroy(slot)
	log.Printf("player %s slot %d expired", id, slot)
	s.emit(Event{Type: "player.expired", Message: id})
}

func (s *Session) Leave(id string, generation uint64) error {
	return s.closePlayer(id, generation, "leave")
}

// Kick frees the slot immediately even if the socket close races ahead and
// puts the player into reconnect grace first, hence generation 0 (any).
func (s *Session) Kick(id string) error {
	s.mu.RLock()
	player := s.players[id]
	if player == nil {
		s.mu.RUnlock()
		return ErrPlayerNotFound
	}
	send, close := player.Send, player.Close
	s.mu.RUnlock()
	if send != nil {
		_ = send(protocol.CloseMessage{Type: protocol.MessageClose, Reason: "kicked"})
	}
	if close != nil {
		close()
	}
	if err := s.closePlayer(id, 0, "kick"); errors.Is(err, ErrPlayerNotFound) {
		return nil
	} else {
		return err
	}
}

func (s *Session) closePlayer(id string, generation uint64, reason string) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
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
	player.State = StateClosed
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
	if target < 0 || target >= maxPlayers {
		return fmt.Errorf("target slot must be between 0 and %d", maxPlayers-1)
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
		return err
	}
	if err := s.devices.Create(target, rumble); err != nil {
		if recreateErr := s.devices.Create(old, rumble); recreateErr != nil {
			s.mu.Lock()
			if current := s.players[id]; current != nil {
				current.State = StateDeviceError
				current.DeviceStatus = "error"
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
	current.DeviceStatus = "ready"
	current.State = StateActive
	send := current.Send
	s.mu.Unlock()
	log.Printf("player %s moved %d -> %d", id, old, target)
	// Tell the phone its slot changed; its socket stays connected and input
	// keeps routing by player ID, so only the chrome label needs this push.
	if send != nil {
		_ = send(protocol.SlotUpdate{Type: protocol.MessageSlotUpdate, Slot: target, Accent: accent})
	}
	s.emit(Event{Type: "player.moved", Player: s.snapshotByID(id)})
	return nil
}

func (s *Session) SetLayout(id, layoutID string) error {
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
	var affected []*Player
	for _, player := range s.players {
		if _, ok := s.layouts.Get(player.LayoutID); !ok {
			player.LayoutID = defaultID
			affected = append(affected, player)
		}
	}
	s.mu.Unlock()
	for _, player := range affected {
		if player.Send != nil {
			_ = player.Send(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: defaultDoc.ID, Layout: defaultDoc})
		}
	}
	if len(affected) > 0 {
		s.emit(Event{Type: "player.layout"})
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
	code, err := newCode()
	if err != nil {
		return err
	}
	s.mu.Lock()
	players := make([]*Player, 0, len(s.players))
	for _, player := range s.players {
		players = append(players, player)
	}
	s.code = code
	s.acceptingJoins = true
	s.players = make(map[string]*Player)
	s.slots = [maxPlayers]*Player{}
	s.mu.Unlock()
	log.Printf("new session code %s", code)
	// Notify connected clients before their close callbacks run. The transport
	// can flush the reset message and then close each socket without leaving
	// phones stuck on the previous session.
	s.emit(Event{Type: "session.reset"})
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
	s.players = make(map[string]*Player)
	s.slots = [maxPlayers]*Player{}
	s.mu.Unlock()
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
