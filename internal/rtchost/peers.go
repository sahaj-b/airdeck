// Package rtchost answers WebRTC phones on the host: one pion
// PeerConnection per phone, DataChannel dispatch, and the same
// session/input contract the LAN socket uses (PLAN Phase 5).
//
// Signaling (offer in, answer out) rides the relay socket owned by
// internal/online; media runs phone-to-host directly or via Cloudflare
// TURN. The reliable `control` channel carries the current JSON protocol
// untouched with a validation-only hello (admit already happened at
// join-forward or accept, so one join can never mint two players). The
// unreliable `inputs` channel carries the 20-byte frames into the same
// Input.Handler the LAN socket uses.
package rtchost

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/rtc"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/turn"
)

const (
	// ControlLabel is the reliable-ordered channel carrying the JSON
	// protocol. InputsLabel is the unreliable-unordered channel carrying
	// 20-byte frames. Both are created by the phone; the host only
	// handles ondatachannel. Labels and protocol match SPEC exactly.
	ControlLabel = "control"
	InputsLabel  = "inputs"
	// DataChannelProtocol tags both channels so a mislabeled future
	// channel fails loudly instead of being misdispatched.
	DataChannelProtocol = "airdeck-v1"
	// maxBufferedBytes mirrors the SPEC drop rule: frames queueing past
	// this on the host control channel are dropped, never blocking input.
	maxBufferedBytes = 1024
	// maxControlBytes caps one control-channel JSON frame, mirroring the
	// LAN socket read limit.
	maxControlBytes = 4 * 1024
	// gatherTimeout bounds ICE gathering so a dead STUN server cannot
	// stall the relay answer loop: the reply goes out with host
	// candidates and the direct path still works.
	gatherTimeout = 5 * time.Second
	// heartbeatInterval matches the LAN socket ping cadence.
	heartbeatInterval = time.Second
	// maxPendingPings mirrors transport.Client: old pings are evicted,
	// never grown.
	maxPendingPings = 8
	// TurnOnlyEnv forces relay-only candidates so the TURN path is
	// reproducible on demand (web side mirrors with iceTransportPolicy).
	TurnOnlyEnv = "AIRDECK_TURN_ONLY"
)

// helloWaitTimeout bounds attach-to-hello: a PC whose control channel
// never says hello leaves an Active player with no transport and no
// expiry (the LAN path cannot leak this way: admit happens at hello).
// Fresh ghosts are kicked, reclaims drop back to grace. A var (not a
// const) so tests shrink it without waiting out the production value.
var helloWaitTimeout = 10 * time.Second

// PeerManager owns one pion PeerConnection per admitted phone.
type PeerManager struct {
	session         *session.Session
	input           *input.Handler
	layouts         *layout.Library
	targetInputRate int

	mu         sync.Mutex
	peers      map[string]*peer // playerID -> peer
	iceServers []rtc.ICEServer
	turnOnly   bool
}

type peer struct {
	pc         *webrtc.PeerConnection
	playerID   string
	generation uint64
	admission  session.Admission

	controlMu sync.Mutex
	control   *webrtc.DataChannel
	attached  bool

	pingMu sync.Mutex
	pings  map[string]time.Time

	closeOnce sync.Once
	closed    chan struct{}
	manager   *PeerManager
}

// New builds a PeerManager over the shared session/input/layouts. ICE
// servers default to STUN-only until the online agent delivers the relay
// bundle; turn-only policy defaults from AIRDECK_TURN_ONLY.
func New(sess *session.Session, handler *input.Handler, layouts *layout.Library, targetInputRate int) *PeerManager {
	return &PeerManager{
		session:         sess,
		input:           handler,
		layouts:         layouts,
		targetInputRate: targetInputRate,
		peers:           make(map[string]*peer),
		iceServers:      turn.STUNOnly(),
		turnOnly:        os.Getenv(TurnOnlyEnv) == "1",
	}
}

// SetTurnOnly forces relay-only candidates (tests and the TURN drill).
func (m *PeerManager) SetTurnOnly(value bool) {
	m.mu.Lock()
	m.turnOnly = value
	m.mu.Unlock()
}

// SetICEServers installs the STUN+TURN bundle from the relay `registered`
// message. It affects subsequently created PeerConnections only; live
// sessions never renegotiate because their TURN allocations live on
// Cloudflare, not on the relay socket.
func (m *PeerManager) SetICEServers(servers []rtc.ICEServer) {
	clone := make([]rtc.ICEServer, len(servers))
	for i, server := range servers {
		urls := make([]string, len(server.URLs))
		copy(urls, server.URLs)
		clone[i] = rtc.ICEServer{URLs: urls, Username: server.Username, Credential: server.Credential}
	}
	m.mu.Lock()
	m.iceServers = clone
	m.mu.Unlock()
}

// toPion converts the shared iceServer shape to pion's. CredentialType is
// password exactly when a credential is present; STUN entries stay bare.
func toPion(servers []rtc.ICEServer) []webrtc.ICEServer {
	out := make([]webrtc.ICEServer, 0, len(servers))
	for _, server := range servers {
		entry := webrtc.ICEServer{URLs: server.URLs, Username: server.Username}
		if server.Credential != "" {
			entry.Credential = server.Credential
			entry.CredentialType = webrtc.ICECredentialTypePassword
		}
		out = append(out, entry)
	}
	return out
}

// HandleJoin admits an open-mode join and answers its offer. Admit rides
// the join itself (reclaim inside grace bumps the generation and skips
// approval, exactly like the LAN path); the control-channel hello later
// only validates and receives the pre-built welcome. A replacement join
// for a known player closes the previous PeerConnection first so only one
// PC drives a slot.
func (m *PeerManager) HandleJoin(join rtc.Join) (string, session.Admission, error) {
	if join.Offer == "" {
		return "", session.Admission{}, errors.New("open-mode join carries no offer")
	}
	m.mu.Lock()
	iceServers := append([]rtc.ICEServer(nil), m.iceServers...)
	turnOnly := m.turnOnly
	m.mu.Unlock()
	admission, err := m.session.Admit(m.session.Code(), join.DisplayName, join.ReconnectID, "", nil, nil)
	if err != nil {
		// Flag skew (relay still open while the dashboard already
		// requires approval) queues a session pending with no relay
		// linkage: evaporate it at once instead of orphaning a queue
		// row that can never complete. The guest retries after the
		// agent re-registers the new flag.
		if errors.Is(err, session.ErrApprovalPending) {
			m.session.RemovePending(admission.PendingID)
		}
		return "", session.Admission{}, err
	}
	answer, pc, err := m.answerOffer(join.Offer, iceServers, turnOnly)
	if err != nil {
		m.abandon(admission)
		return "", session.Admission{}, err
	}
	m.attach(admission, pc)
	return answer, admission, nil
}

// HandleOffer answers a post-accept approval offer for an already
// admitted player. The admission comes from the accept the agent stored;
// this never runs Admit and so can never mint a second player.
func (m *PeerManager) HandleOffer(offer rtc.Offer, admission session.Admission) (string, error) {
	if offer.SDP == "" {
		return "", errors.New("approval offer carries no sdp")
	}
	if admission.Player.ID == "" {
		return "", errors.New("approval offer has no admitted player")
	}
	m.mu.Lock()
	iceServers := append([]rtc.ICEServer(nil), m.iceServers...)
	turnOnly := m.turnOnly
	m.mu.Unlock()
	answer, pc, err := m.answerOffer(offer.SDP, iceServers, turnOnly)
	if err != nil {
		m.abandon(admission)
		return "", err
	}
	m.attach(admission, pc)
	return answer, nil
}

// abandon frees a slot whose answer never went out (bad SDP, failed PC).
// A fresh player is kicked at once; a reclaimed player drops back to
// reconnect grace so a retry can still reclaim it. Without this a failed
// answer leaks an Active slot with no transport and no expiry.
func (m *PeerManager) abandon(admission session.Admission) {
	if admission.Reconnected {
		_ = m.input.Disconnect(admission.Player.ID, admission.Player.Generation)
		return
	}
	_ = m.session.Kick(admission.Player.ID)
}

// answerOffer builds one PeerConnection, applies the remote offer, and
// returns the gathered answer SDP. Non-trickle v1: gather completes (or
// times out to host candidates) before the reply goes out, one relay
// round-trip per direction.
func (m *PeerManager) answerOffer(offerSDP string, iceServers []rtc.ICEServer, turnOnly bool) (string, *webrtc.PeerConnection, error) {
	config := webrtc.Configuration{ICEServers: toPion(iceServers)}
	if turnOnly {
		config.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return "", nil, fmt.Errorf("create peer connection: %w", err)
	}
	failed := true
	defer func() {
		if failed {
			_ = pc.Close()
		}
	}()
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offerSDP}); err != nil {
		return "", nil, fmt.Errorf("apply remote offer: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return "", nil, fmt.Errorf("create answer: %w", err)
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		return "", nil, fmt.Errorf("apply local answer: %w", err)
	}
	select {
	case <-webrtc.GatheringCompletePromise(pc):
	case <-time.After(gatherTimeout):
		log.Printf("rtchost: ICE gathering timed out, answering with host candidates")
	}
	description := pc.LocalDescription()
	if description == nil {
		return "", nil, errors.New("peer connection has no local description after answer")
	}
	failed = false
	return description.SDP, pc, nil
}

// attach wires datachannel dispatch plus connection-state teardown to one
// admitted player, replacing any previous PeerConnection for that player.
func (m *PeerManager) attach(admission session.Admission, pc *webrtc.PeerConnection) {
	p := &peer{
		pc:         pc,
		playerID:   admission.Player.ID,
		generation: admission.Player.Generation,
		admission:  admission,
		closed:     make(chan struct{}),
		manager:    m,
		pings:      make(map[string]time.Time),
	}
	pc.OnDataChannel(p.onDataChannel)
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			p.teardown()
		}
	})
	m.mu.Lock()
	old, replaced := m.peers[p.playerID]
	m.peers[p.playerID] = p
	m.mu.Unlock()
	// Swap under the lock, clean up after it: concurrent attaches for one
	// player cannot orphan a live PC anymore. Replacement is close-only,
	// never Disconnect: the slot belongs to the winner now, and bumping
	// the generation would invalidate the winner's stored gen so its
	// hello fails. Stale inputs from the dying PC carry the old
	// generation and drop harmlessly.
	if replaced {
		old.closePC()
	}
	m.armHelloTimeout(p)
}

// armHelloTimeout kicks a ghost whose control channel never says hello.
// The timer no-ops once the validation-only hello attaches: presence in
// the peers map plus !attached is the ghost signal, checked under one
// lock grab so a racing hello always wins.
func (m *PeerManager) armHelloTimeout(p *peer) {
	time.AfterFunc(helloWaitTimeout, func() {
		p.controlMu.Lock()
		attached := p.attached
		p.controlMu.Unlock()
		if attached {
			return
		}
		m.mu.Lock()
		if current, ok := m.peers[p.playerID]; !ok || current != p {
			m.mu.Unlock()
			return
		}
		delete(m.peers, p.playerID)
		m.mu.Unlock()
		p.closePC()
		m.abandon(p.admission)
	})
}

// onDataChannel dispatches the phone-created channels by label. Unknown
// labels are ignored, never misdispatched.
func (p *peer) onDataChannel(channel *webrtc.DataChannel) {
	switch channel.Label() {
	case ControlLabel:
		p.serveControl(channel)
	case InputsLabel:
		p.serveInputs(channel)
	default:
		log.Printf("rtchost: ignoring unknown data channel %q", channel.Label())
	}
}

// serveControl runs the validation-only hello plus the identical JSON
// protocol the LAN socket serves: welcome, layout, 1s ping/pong,
// layout.select, close. The hello never admits; it validates the code,
// attaches the live sender to the already-admitted player, and receives
// the pre-built welcome.
func (p *peer) serveControl(channel *webrtc.DataChannel) {
	channel.OnOpen(func() {
		p.controlMu.Lock()
		p.control = channel
		p.controlMu.Unlock()
	})
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		if !message.IsString {
			p.sendError("invalid_message", "control channel carries JSON text only")
			return
		}
		if len(message.Data) > maxControlBytes {
			p.sendError("invalid_message", "control message is too large")
			return
		}
		p.controlMu.Lock()
		attached := p.controlAttachedLocked()
		p.controlMu.Unlock()
		if !attached {
			p.handleHello(message.Data)
			return
		}
		p.handleText(message.Data)
	})
}

// controlAttachedLocked reports whether the validation-only hello already
// installed this channel as the player's sender.
func (p *peer) controlAttachedLocked() bool {
	return p.control != nil && p.attached
}

// handleHello validates the first control message and attaches the live
// channel to the admitted player. Parity with transport.runClient up to
// the Admit call, which already happened at join-forward or accept.
func (p *peer) handleHello(data []byte) {
	m := p.manager
	hello, err := protocol.DecodeHello(data)
	if err != nil || hello.ClientVersion == "" {
		p.sendErrorAndClose("invalid_hello", "the first message must be a valid hello")
		return
	}
	if err := m.session.CheckCode(hello.SessionCode); err != nil {
		code, message := session.AdmissionError(err)
		p.sendErrorAndClose(code, message)
		return
	}
	if err := m.session.AttachTransport(p.playerID, p.generation, p.sendJSON, p.closeFromPhone); err != nil {
		code, message := session.AdmissionError(err)
		p.sendErrorAndClose(code, message)
		return
	}
	p.controlMu.Lock()
	p.attached = true
	p.controlMu.Unlock()
	// The join carries no layout choice, but the hello does: apply the
	// phone's stored selection exactly like Admit would (unknown ids fall
	// back to the session default by staying put).
	if hello.SelectedLayout != "" && hello.SelectedLayout != p.admission.Player.LayoutID {
		if _, ok := m.layouts.Get(hello.SelectedLayout); ok {
			_ = m.session.SetLayout(p.playerID, hello.SelectedLayout)
		}
	}
	player, ok := m.session.Player(p.playerID)
	if !ok {
		p.sendErrorAndClose("device_error", "The host could not create your virtual controller.")
		return
	}
	if err := p.sendValue(session.BuildWelcome(player, m.layouts, m.targetInputRate)); err != nil {
		return
	}
	document, err := m.session.Layout(p.playerID)
	if err != nil {
		return
	}
	if err := p.sendValue(protocol.LayoutMessage{Type: protocol.MessageLayout, ID: document.ID, Layout: document}); err != nil {
		return
	}
	p.heartbeat()
}

// handleText mirrors transport.Server.handleText: pong, layout.select,
// close. Anything else is an invalid_message, byte-identical codes.
func (p *peer) handleText(data []byte) {
	m := p.manager
	typeName, err := protocol.MessageType(data)
	if err != nil {
		p.sendError("invalid_message", err.Error())
		return
	}
	switch typeName {
	case protocol.MessagePong:
		var pong protocol.Pong
		if json.Unmarshal(data, &pong) != nil {
			return
		}
		if sent, ok := p.takePing(pong.ID); ok {
			_ = m.session.SetPong(p.playerID, p.generation, time.Since(sent))
		}
	case protocol.MessageLayoutSelect:
		var selectMessage protocol.LayoutSelect
		if err := json.Unmarshal(data, &selectMessage); err != nil {
			p.sendError("invalid_layout", err.Error())
			return
		}
		if err := m.session.SetLayout(p.playerID, selectMessage.ID); err != nil {
			p.sendError("invalid_layout", err.Error())
		}
	case protocol.MessageClose:
		_ = m.session.Leave(p.playerID, p.generation)
		p.closePC()
	default:
		p.sendError("invalid_message", fmt.Sprintf("unsupported message type %q", typeName))
	}
}

// serveInputs decodes 20-byte frames into the shared Input.Handler. Stale
// or duplicate frames use the same wrap-aware dedup as the LAN path; a
// decode failure reports input_rejected on the control channel.
func (p *peer) serveInputs(channel *webrtc.DataChannel) {
	channel.OnMessage(func(message webrtc.DataChannelMessage) {
		if message.IsString {
			p.sendError("invalid_frame", "inputs channel carries binary frames only")
			return
		}
		frame, err := protocol.DecodeFrame(message.Data)
		if err != nil {
			p.sendError("invalid_frame", err.Error())
			return
		}
		if err := p.manager.input.Handle(p.playerID, p.generation, frame); err != nil && !errors.Is(err, session.ErrGeneration) {
			p.sendError("input_rejected", err.Error())
		}
	})
}

// sendJSON is the Session.Send transport: JSON over the control channel
// with the SPEC drop rule. A full buffer drops the message (rumble under
// pressure) instead of stalling input; welcome/layout/heartbeat are
// low-rate and never trip it on a fresh channel.
func (p *peer) sendJSON(value any) error {
	return p.sendValue(value)
}

func (p *peer) sendValue(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	p.controlMu.Lock()
	channel := p.control
	p.controlMu.Unlock()
	if channel == nil || channel.ReadyState() != webrtc.DataChannelStateOpen {
		if _, isRumble := value.(protocol.Rumble); !isRumble {
			return errors.New("rtc control channel is not open")
		}
		return nil
	}
	if channel.BufferedAmount() > maxBufferedBytes {
		if _, isRumble := value.(protocol.Rumble); isRumble {
			return nil
		}
		return errors.New("rtc control channel is congested")
	}
	if _, isClose := value.(protocol.CloseMessage); isClose {
		// Flush the farewell before tearing down: SCTP drops queued
		// sends on immediate PC close, unlike the TCP writer queue.
		defer p.closeSoon()
	}
	// JSON rides the control channel as text, exactly like the LAN
	// socket's text frames; binary is reserved for input snapshots.
	return channel.SendText(string(payload))
}

// sendError reports a protocol error on the control channel when it is
// usable; reporting must never break input, so failures are swallowed.
func (p *peer) sendError(code, message string) {
	_ = p.sendValue(protocol.ErrorMessage{Type: protocol.MessageError, Code: code, Message: message})
}

// sendErrorAndClose queues the final error before tearing down, mirroring
// the LAN socket sendAndClose path. The close is delayed one flush
// interval so the error actually reaches the phone.
func (p *peer) sendErrorAndClose(code, message string) {
	payload, err := json.Marshal(protocol.ErrorMessage{Type: protocol.MessageError, Code: code, Message: message})
	if err != nil {
		p.closePC()
		return
	}
	p.controlMu.Lock()
	channel := p.control
	p.controlMu.Unlock()
	if channel != nil && channel.ReadyState() == webrtc.DataChannelStateOpen {
		_ = channel.SendText(string(payload))
		p.closeSoon()
		return
	}
	p.closePC()
}

// closeSoon tears down after a flush interval for farewell/error paths.
// closePC stays immediate for teardown and shutdown, where no message
// is owed. Both are idempotent through the same once-guard.
func (p *peer) closeSoon() {
	time.AfterFunc(200*time.Millisecond, p.closePC)
}

// heartbeat mirrors transport.Server.heartbeat: 1s pings carrying the
// last measured RTT, pongs feeding Session.SetPong.
func (p *peer) heartbeat() {
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-p.closed:
				return
			case now := <-ticker.C:
				id := fmt.Sprintf("%d", now.UnixNano())
				p.trackPing(id, now)
				ping := protocol.Ping{Type: protocol.MessagePing, ID: id, Sent: uint64(now.UnixNano())}
				if snapshot, ok := p.manager.session.Player(p.playerID); ok && snapshot.RTT > 0 {
					ping.RttMs = snapshot.RTT / int64(time.Millisecond)
				}
				if err := p.sendValue(ping); err != nil {
					return
				}
			}
		}
	}()
}

func (p *peer) trackPing(id string, sent time.Time) {
	p.pingMu.Lock()
	if len(p.pings) >= maxPendingPings {
		var oldestID string
		var oldest time.Time
		for pendingID, timestamp := range p.pings {
			if oldestID == "" || timestamp.Before(oldest) {
				oldestID, oldest = pendingID, timestamp
			}
		}
		delete(p.pings, oldestID)
	}
	p.pings[id] = sent
	p.pingMu.Unlock()
}

func (p *peer) takePing(id string) (time.Time, bool) {
	p.pingMu.Lock()
	defer p.pingMu.Unlock()
	sent, ok := p.pings[id]
	if ok {
		delete(p.pings, id)
	}
	return sent, ok
}

// closeFromPhone is the Session.Close transport: the player left or was
// kicked, so the PC goes down with it.
func (p *peer) closeFromPhone() {
	p.closePC()
}

// teardown runs on Failed/Closed: the authoritative disconnect path now
// that the guest signaling socket closed at establishment. It mirrors the
// LAN socket defer (Input.Disconnect into reconnect grace) exactly, but
// only when this peer still owns the slot: a replaced loser closing late
// must never bump the winner's generation.
func (p *peer) teardown() {
	m := p.manager
	m.mu.Lock()
	owned := false
	if current, ok := m.peers[p.playerID]; ok && current == p {
		delete(m.peers, p.playerID)
		owned = true
	}
	m.mu.Unlock()
	p.closePC()
	if owned {
		_ = m.input.Disconnect(p.playerID, p.generation)
	}
}

// closePC idempotently shuts one PeerConnection and stops its heartbeat.
func (p *peer) closePC() {
	p.closeOnce.Do(func() {
		close(p.closed)
		_ = p.pc.Close()
	})
}

// PeerCount reports live PeerConnections (diagnostics and tests).
func (m *PeerManager) PeerCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.peers)
}

// Close tears down every PeerConnection. Shutdown order in app calls this
// alongside Transport.Close: data paths stop together, then devices.
func (m *PeerManager) Close() {
	m.mu.Lock()
	peers := make([]*peer, 0, len(m.peers))
	for _, p := range m.peers {
		peers = append(peers, p)
	}
	m.peers = make(map[string]*peer)
	m.mu.Unlock()
	for _, p := range peers {
		p.closePC()
	}
}
