// Package online keeps the host registered on the central relay: the
// outbound register loop, the reachability probe driving the QR flip, and
// the relay-side routing of joins into the session plus PeerManager.
//
// Established DataChannels never depend on this socket: a relay outage
// freezes only new remote joins while TURN allocations on Cloudflare and
// live PCs keep running. A permanent claim conflict stops the register
// loop with no retry until the owner resolves it via the dashboard;
// network failures retry with backoff.
package online

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/stun/v4"
	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/rtc"
	"github.com/sahaj-b/airdeck/internal/rtchost"
	"github.com/sahaj-b/airdeck/internal/session"
)

const (
	// DefaultRelayURL is the production signal relay register endpoint.
	// AIRDECK_RELAY_URL overrides it for localhost drills.
	DefaultRelayURL = "wss://signal.airdeck.sahaj.dev/register"
	// RelayURLEnv overrides the register endpoint (localhost drills).
	RelayURLEnv = "AIRDECK_RELAY_URL"
	// OnlineJoinBase is the join-page base for the advertised online URL.
	OnlineJoinBase = "https://airdeck.sahaj.dev/join"
	// stunAddr is the Cloudflare STUN endpoint used for the probe bind.
	stunAddr = "stun.cloudflare.com:3478"
	// probeInterval re-checks central reachability; probeTimeout bounds
	// one check so a dead network never stalls the loop.
	probeInterval = 30 * time.Second
	probeTimeout  = 3 * time.Second
	// sendQueue bounds one slow socket so it never stalls answers.
	sendQueue = 128
	// writeTimeout bounds one signaling write.
	writeTimeout = 5 * time.Second
	// backoffStart/Max bound register retries on network failure.
	backoffStart = time.Second
	backoffMax   = 30 * time.Second
)

// offerWaitTimeout bounds accept-to-offer; a var so tests shrink it.
var offerWaitTimeout = 30 * time.Second

// Options configures one agent. The session owns the room code.
type Options struct {
	InstallationKey  string
	ApprovalRequired bool
	LanOnly          bool
	RelayURL         string
	Session          *session.Session
	Peers            *rtchost.PeerManager
	OnStateChange    func()
}

// Agent owns the host relay socket and the reachability probe.
type Agent struct {
	mu               sync.Mutex
	installationKey  string
	approvalRequired bool
	lanOnly          bool
	relayURL         string
	session          *session.Session
	peers            *rtchost.PeerManager
	onStateChange    func()

	reachable bool
	conflict  string

	// approvals maps a relay-assigned pending id to the session pending
	// (queued) or admission (accepted, awaiting its post-accept offer).
	approvals map[string]*approval
	// connMu serializes signaling writes; the read loop never holds it.
	connMu sync.Mutex
	conn   *websocket.Conn
	out    chan []byte

	done    chan struct{}
	closeMu sync.Mutex
	closed  bool
	wg      sync.WaitGroup
	retryCh chan struct{}
}

type approval struct {
	sessionPending string
	admission      session.Admission
	accepted       bool
}

// New builds a stopped agent. Call Start to probe and register.
func New(opts Options) *Agent {
	relayURL := opts.RelayURL
	if relayURL == "" {
		relayURL = os.Getenv(RelayURLEnv)
	}
	if relayURL == "" {
		relayURL = DefaultRelayURL
	}
	return &Agent{
		installationKey:  opts.InstallationKey,
		approvalRequired: opts.ApprovalRequired,
		lanOnly:          opts.LanOnly,
		relayURL:         relayURL,
		session:          opts.Session,
		peers:            opts.Peers,
		onStateChange:    opts.OnStateChange,
		approvals:        make(map[string]*approval),
		retryCh:          make(chan struct{}, 1),
	}
}

// Reachable reports the last probe outcome. Live sessions never consult
// it; only new remote joins and the advertised URL do.
func (a *Agent) Reachable() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return !a.lanOnly && a.reachable
}

// Conflict reports the durable-claim conflict reason, or "" when the
// desired code is ours. While set, remote stays dark and the QR flips to
// LAN, which keeps serving the local code.
func (a *Agent) Conflict() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conflict
}

// OnlineJoinURL builds the persistent join-page URL for one room code.
func OnlineJoinURL(roomCode string) string {
	join := OnlineJoinBase + "?code=" + url.QueryEscape(roomCode)
	return join
}

// Start probes once in the background and launches the register loop,
// unless lanOnly forces offline without probing.
func (a *Agent) Start() {
	a.mu.Lock()
	lanOnly := a.lanOnly
	a.mu.Unlock()
	if lanOnly {
		a.setReachable(false)
		return
	}
	a.wg.Add(2)
	go a.probeLoop()
	go a.registerLoop()
}

// Retry wakes the register loop: the dashboard calls it after the owner
// resolves a conflict with a new code.
func (a *Agent) Retry() {
	select {
	case a.retryCh <- struct{}{}:
	default:
	}
}

// SetCode installs a new desired room code plus approval flag (dashboard
// resolve path) and retries registration immediately. The session is the
// single source of truth for the code: it updates together with the
// agent so LAN validation and relay routing never diverge.
func (a *Agent) SetCode(roomCode string, approvalRequired bool) {
	normalized := roomcode.Normalize(roomCode)
	a.mu.Lock()
	a.approvalRequired = approvalRequired
	a.conflict = ""
	a.mu.Unlock()
	a.session.SetCode(normalized)
	a.session.SetApprovalRequired(approvalRequired)
	a.notify()
	a.closeConn()
	a.Retry()
}

// SetApprovalRequired mirrors the dashboard toggle onto future registers.
func (a *Agent) SetApprovalRequired(value bool) {
	a.mu.Lock()
	if a.approvalRequired == value {
		a.mu.Unlock()
		return
	}
	a.approvalRequired = value
	a.mu.Unlock()
	a.session.SetApprovalRequired(value)
	a.closeConn()
	a.Retry()
}

// Close stops the probe and register loops and drops the socket.
func (a *Agent) Close() {
	a.closeMu.Lock()
	if a.closed {
		a.closeMu.Unlock()
		return
	}
	a.closed = true
	if a.done == nil {
		a.done = make(chan struct{})
	}
	close(a.done)
	a.closeMu.Unlock()
	a.closeConn()
	a.wg.Wait()
}

func (a *Agent) doneCh() <-chan struct{} {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	if a.done == nil {
		a.done = make(chan struct{})
	}
	return a.done
}

func (a *Agent) setReachable(value bool) {
	a.mu.Lock()
	changed := a.reachable != value
	a.reachable = value
	a.mu.Unlock()
	if changed {
		a.notify()
	}
}

func (a *Agent) setConflict(reason string) {
	a.mu.Lock()
	changed := a.conflict != reason
	a.conflict = reason
	a.mu.Unlock()
	if changed {
		a.notify()
	}
}

func (a *Agent) notify() {
	a.mu.Lock()
	callback := a.onStateChange
	a.mu.Unlock()
	if callback != nil {
		callback()
	}
}

// healthURL derives the relay /health endpoint from the register URL:
// wss://host/register -> https://host/health (localhost drills keep
// their port; path is always exactly /health).
func healthURL(registerURL string) string {
	parsed, err := url.Parse(registerURL)
	if err != nil {
		return ""
	}
	switch parsed.Scheme {
	case "wss":
		parsed.Scheme = "https"
	case "ws":
		parsed.Scheme = "http"
	default:
		return ""
	}
	parsed.Path = "/health"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

// probeLoop checks central reachability at start and every interval.
// Either the relay /health GET or one STUN bind succeeding (3s timeout
// each) means reachable; lanOnly never probes.
func (a *Agent) probeLoop() {
	defer a.wg.Done()
	done := a.doneCh()
	a.probeOnce()
	ticker := time.NewTicker(probeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			a.probeOnce()
		}
	}
}

func (a *Agent) probeOnce() {
	a.mu.Lock()
	relayURL := a.relayURL
	a.mu.Unlock()
	healthOK := probeHealth(healthURL(relayURL))
	stunOK := false
	if !healthOK {
		stunOK = probeSTUN(stunAddr, probeTimeout)
	}
	a.setReachable(healthOK || stunOK)
}

func probeHealth(health string) bool {
	if health == "" {
		return false
	}
	client := &http.Client{Timeout: probeTimeout}
	resp, err := client.Get(health)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// probeSTUN runs one real binding transaction: UDP dial alone proves
// nothing (no handshake), so a BindingRequest must draw a
// BindingSuccess within the timeout.
func probeSTUN(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("udp", addr, timeout)
	if err != nil {
		return false
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	request := stun.New()
	request.Type = stun.BindingRequest
	request.TransactionID = stun.NewTransactionID()
	request.Encode()
	if _, err := conn.Write(request.Raw); err != nil {
		return false
	}
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil {
		return false
	}
	if !stun.IsMessage(buf[:n]) {
		return false
	}
	response := &stun.Message{Raw: buf[:n]}
	if err := response.Decode(); err != nil {
		return false
	}
	return response.Type == stun.BindingSuccess
}

// registerLoop holds the outbound relay socket: register, serve forwards,
// retry network failures with backoff, stop on permanent conflict.
func (a *Agent) registerLoop() {
	defer a.wg.Done()
	done := a.doneCh()
	backoff := backoffStart
	for {
		select {
		case <-done:
			return
		default:
		}
		stop, retrySoon := a.serveRegister(done)
		if stop {
			return
		}
		if retrySoon {
			backoff = backoffStart
			continue
		}
		select {
		case <-done:
			return
		case <-a.retryCh:
			backoff = backoffStart
		case <-time.After(backoff):
			backoff *= 2
			if backoff > backoffMax {
				backoff = backoffMax
			}
		}
	}
}

// serveRegister runs one socket lifetime. It reports (stop, retrySoon):
// stop ends the loop (closed or permanent conflict), retrySoon redials
// immediately (explicit Retry or post-resolve SetCode).
func (a *Agent) serveRegister(done <-chan struct{}) (bool, bool) {
	a.mu.Lock()
	relayURL, key, approval := a.relayURL, a.installationKey, a.approvalRequired
	a.mu.Unlock()
	// The session is the single code source; the agent never admits or
	// registers by its own copy.
	dialer := websocket.Dialer{HandshakeTimeout: probeTimeout}
	conn, _, err := dialer.Dial(relayURL, nil)
	if err != nil {
		log.Printf("online: relay dial failed, retrying: %v", err)
		return false, false
	}
	a.connMu.Lock()
	a.conn = conn
	a.out = make(chan []byte, sendQueue)
	out := a.out
	a.connMu.Unlock()
	// finish joins the writer: closing the socket alone cannot unblock
	// a writer parked on the queue receive, so every exit path closes
	// finish and drains writeDone before returning.
	finish := make(chan struct{})
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			select {
			case <-done:
				return
			case <-finish:
				return
			case data := <-out:
				_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
				if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
					return
				}
			}
		}
	}()
	register, err := json.Marshal(rtc.Register{
		Type:             rtc.MessageRegister,
		RoomCode:         a.session.Code(),
		InstallationKey:  key,
		ApprovalRequired: approval,
	})
	if err != nil {
		a.closeConn()
		close(finish)
		<-writeDone
		return false, false
	}
	_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	if err := conn.WriteMessage(websocket.TextMessage, register); err != nil {
		log.Printf("online: relay register write failed, retrying: %v", err)
		a.closeConn()
		close(finish)
		<-writeDone
		return false, false
	}
	// The writer only exits on close, finish, or write failure; the reader
	// below is the loop's eyes. When either ends, the socket lifetime ends.
	readResult := make(chan bool, 1)
	go func() {
		readResult <- a.readLoop(conn, done)
	}()
	stop := false
	retrySoon := false
	conflicted := false
	select {
	case <-done:
		stop = true
	case <-a.retryCh:
		retrySoon = true
	case conflict := <-readResult:
		conflicted = conflict
	case <-writeDone:
	}
	a.closeConn()
	close(finish)
	<-writeDone
	if stop || conflicted {
		return true, false
	}
	return false, retrySoon
}

// readLoop serves one register socket until it drops. It returns true
// only for a permanent claim conflict (stop without retry); every other
// ending retries with backoff.
func (a *Agent) readLoop(conn *websocket.Conn, done <-chan struct{}) bool {
	for {
		select {
		case <-done:
			return false
		default:
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			select {
			case <-done:
				return false
			default:
			}
			log.Printf("online: relay connection lost, retrying: %v", err)
			return false
		}
		msgType, err := rtc.MessageType(data)
		if err != nil {
			continue
		}
		switch msgType {
		case rtc.MessageRegistered:
			a.handleRegistered(data)
		case rtc.MessageConflict:
			a.handleConflict(data)
			return true
		case rtc.MessageJoin:
			a.handleRelayJoin(data)
		case rtc.MessagePending:
			a.handleRelayPending(data)
		case rtc.MessageOffer:
			a.handleRelayOffer(data)
		case rtc.MessagePeerLeft:
			a.handlePeerLeft(data)
		default:
			// Unknown relay frames are ignored, never acted on.
		}
	}
}

func (a *Agent) send(value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	a.connMu.Lock()
	out := a.out
	a.connMu.Unlock()
	if out == nil {
		return
	}
	select {
	case out <- data:
	default:
		log.Printf("online: signaling outbound full, dropping message")
	}
}

func (a *Agent) closeConn() {
	a.connMu.Lock()
	conn := a.conn
	a.conn = nil
	a.out = nil
	a.connMu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}

func (a *Agent) handleRegistered(data []byte) {
	var registered rtc.Registered
	if err := json.Unmarshal(data, &registered); err != nil {
		return
	}
	a.peers.SetICEServers(registered.ICEServers)
	a.setConflict("")
	a.setReachable(true)
	log.Printf("online: registered room %s on central", registered.RoomCode)
}

func (a *Agent) handleConflict(data []byte) {
	var conflict rtc.Conflict
	if err := json.Unmarshal(data, &conflict); err != nil {
		conflict.Reason = "room code is claimed by another installation"
	}
	// Permanent until the owner resolves via the dashboard: stop the loop
	// with no retry. LAN keeps serving the local code; remote stays dark.
	a.setConflict(conflict.Reason)
	log.Printf("online: claim conflict, remote dark until resolved: %s", conflict.Reason)
}

// handleRelayJoin answers an open-mode forwarded join. Admit rides the
// join itself through the PeerManager. Admit failures (full, closed)
// never answer: the relay has no host-to-guest error path for open
// flows, so the guest PC stays connecting until the phone-side join
// timeout fires (the phone owns that timer); answering anyway would
// establish media against no player, which is worse than a slow no.
func (a *Agent) handleRelayJoin(data []byte) {
	var join rtc.Join
	if err := json.Unmarshal(data, &join); err != nil || join.Offer == "" || join.CorrelationID == "" {
		return
	}
	go func() {
		answer, _, err := a.peers.HandleJoin(join)
		if err != nil {
			log.Printf("online: open join answer failed: %v", err)
			return
		}
		a.send(rtc.Answer{Type: rtc.MessageAnswer, CorrelationID: join.CorrelationID, SDP: answer})
	}()
}

// handleRelayPending queues an approval-mode join in the session.
func (a *Agent) handleRelayPending(data []byte) {
	var pending rtc.Pending
	if err := json.Unmarshal(data, &pending); err != nil || pending.PendingID == "" {
		return
	}
	admission, err := a.session.Admit(a.session.Code(), pending.DisplayName, pending.ReconnectID, "", nil, nil)
	if err != nil {
		if errors.Is(err, session.ErrApprovalPending) {
			a.mu.Lock()
			a.approvals[pending.PendingID] = &approval{sessionPending: admission.PendingID}
			a.mu.Unlock()
			a.notify()
			return
		}
		log.Printf("online: approval join rejected: %v", err)
		a.send(rtc.Reject{Type: rtc.MessageReject, PendingID: pending.PendingID, Reason: rejectReason(err)})
		return
	}
	// Admitted at once: either an in-grace reclaimer skipping the queue,
	// or approval off while the relay queued (flag skew across re-register).
	a.mu.Lock()
	a.approvals[pending.PendingID] = &approval{admission: admission, accepted: true}
	a.mu.Unlock()
	a.send(rtc.Accept{Type: rtc.MessageAccept, PendingID: pending.PendingID})
	a.armOfferTimeout(pending.PendingID, admission)
}

func rejectReason(err error) string {
	switch {
	case errors.Is(err, session.ErrSessionFull):
		return "session is full"
	case errors.Is(err, session.ErrJoinsClosed):
		return "session is not accepting joins"
	default:
		return "join was not accepted"
	}
}

// handleRelayOffer answers a post-accept offer for a stored admission.
// Unknown or evaporated pendings are ignored: the guest already went
// away and will rejoin if it is still around.
func (a *Agent) handleRelayOffer(data []byte) {
	var offer rtc.Offer
	if err := json.Unmarshal(data, &offer); err != nil || offer.SDP == "" || offer.CorrelationID == "" {
		return
	}
	// The relay always forwards the approval pendingId (contract); an
	// offer without one is unroutable and ignored, never fuzzy-matched
	// to another guest's admission.
	if offer.PendingID == "" {
		return
	}
	a.mu.Lock()
	entry := a.approvals[offer.PendingID]
	a.mu.Unlock()
	if entry == nil || !entry.accepted {
		return
	}
	admission := entry.admission
	pendingID := offer.PendingID
	go func() {
		answer, err := a.peers.HandleOffer(offer, admission)
		if err != nil {
			log.Printf("online: approval offer answer failed: %v", err)
			// The slot is already freed by the PeerManager; drop the
			// dead admission so a retried offer cannot attach to a
			// kicked player and the dashboard counts stay truthful.
			a.forgetApproval(pendingID, entry)
			return
		}
		// One-shot: a retransmitted offer after a successful answer is
		// ignored instead of double-answering a second PC.
		a.forgetApproval(pendingID, entry)
		a.send(rtc.Answer{Type: rtc.MessageAnswer, CorrelationID: offer.CorrelationID, SDP: answer})
	}()
}

// handlePeerLeft evaporates a pre-establishment pending whose guest went away.
func (a *Agent) handlePeerLeft(data []byte) {
	var left rtc.PeerLeft
	if err := json.Unmarshal(data, &left); err != nil || left.PendingID == "" {
		return
	}
	a.mu.Lock()
	entry := a.approvals[left.PendingID]
	if entry != nil {
		delete(a.approvals, left.PendingID)
	}
	a.mu.Unlock()
	if entry == nil {
		return
	}
	if entry.sessionPending != "" {
		a.session.RemovePending(entry.sessionPending)
	} else if entry.accepted {
		a.dropAdmission(entry.admission)
	}
	a.notify()
}

// AcceptPending continues one queued approval join toward slot assignment
// and releases the guest to offer; a full session keeps the pending queued
// and reports the error.
func (a *Agent) AcceptPending(relayPendingID string) error {
	a.mu.Lock()
	entry := a.approvals[relayPendingID]
	a.mu.Unlock()
	if entry == nil || entry.accepted {
		return session.ErrPendingNotFound
	}
	admission, err := a.session.AcceptPending(entry.sessionPending)
	if err != nil {
		return err
	}
	a.mu.Lock()
	entry.admission = admission
	entry.accepted = true
	entry.sessionPending = ""
	a.mu.Unlock()
	a.send(rtc.Accept{Type: rtc.MessageAccept, PendingID: relayPendingID})
	a.armOfferTimeout(relayPendingID, admission)
	a.notify()
	return nil
}

// RejectPending drops one queued approval join with a human reason.
func (a *Agent) RejectPending(relayPendingID, reason string) error {
	a.mu.Lock()
	entry := a.approvals[relayPendingID]
	if entry != nil {
		delete(a.approvals, relayPendingID)
	}
	a.mu.Unlock()
	if entry == nil || entry.accepted {
		return session.ErrPendingNotFound
	}
	_ = a.session.RejectPending(entry.sessionPending, reason)
	a.send(rtc.Reject{Type: rtc.MessageReject, PendingID: relayPendingID, Reason: reason})
	a.notify()
	return nil
}

// armOfferTimeout frees an accepted admission whose post-accept offer
// never arrives (guest vanished after accepted, so no peer.left fires
// and no PC ever exists for the hello timeout to reap). The normal flow
// deletes the entry on first answer, so the timer no-ops; only a
// vanished guest trips it.
func (a *Agent) armOfferTimeout(relayPendingID string, admission session.Admission) {
	time.AfterFunc(offerWaitTimeout, func() {
		a.mu.Lock()
		entry, ok := a.approvals[relayPendingID]
		if !ok || !entry.accepted {
			a.mu.Unlock()
			return
		}
		delete(a.approvals, relayPendingID)
		a.mu.Unlock()
		a.dropAdmission(admission)
		a.notify()
	})
}

// forgetApproval drops one relay approval only if it still maps to entry.
func (a *Agent) forgetApproval(pendingID string, entry *approval) {
	a.mu.Lock()
	if current := a.approvals[pendingID]; current == entry {
		delete(a.approvals, pendingID)
	}
	a.mu.Unlock()
}

// dropAdmission frees one accepted slot: reclaims drop back to grace,
// fresh admissions kick at once.
func (a *Agent) dropAdmission(admission session.Admission) {
	if admission.Player.ID == "" {
		return
	}
	if admission.Reconnected {
		_ = a.session.Disconnect(admission.Player.ID, admission.Player.Generation)
	} else {
		_ = a.session.Kick(admission.Player.ID)
	}
}

// RelayState is the dashboard transport badge for one player: relayed,
// direct, or unknown (still connecting, PC gone, or LAN socket player).
type RelayState string

const (
	RelayUnknown RelayState = "unknown"
	RelayDirect  RelayState = "direct"
	RelayRelayed RelayState = "relayed"
)

// RelayTransport reports the dashboard transport badge for one player.
func (a *Agent) IsRelayed(playerID string) bool {
	if a == nil || a.peers == nil {
		return false
	}
	relayed, _ := a.peers.IsRelayed(playerID)
	return relayed
}

// RelayTransport reports direct/relayed/unknown so the dashboard can
// show a pending state instead of lying with direct while ICE connects.
func (a *Agent) RelayTransport(playerID string) RelayState {
	if a == nil || a.peers == nil {
		return RelayUnknown
	}
	relayed, known := a.peers.IsRelayed(playerID)
	if !known {
		return RelayUnknown
	}
	if relayed {
		return RelayRelayed
	}
	return RelayDirect
}

// show a pending state instead of lying with direct while ICE connects.

// Pendings returns the queued relay approvals for the dashboard queue.
// Each entry carries the relay pending id (the dashboard accept/reject
// key), with display name plus waiting time resolved from the backing
// session pending. Accepted admissions awaiting their post-accept offer
// are players already, never queue rows.
func (a *Agent) Pendings() []session.PendingSnapshot {
	a.mu.Lock()
	queued := make(map[string]string, len(a.approvals))
	for relayID, entry := range a.approvals {
		if !entry.accepted {
			queued[relayID] = entry.sessionPending
		}
	}
	a.mu.Unlock()
	if len(queued) == 0 {
		return nil
	}
	bySession := make(map[string]session.PendingSnapshot, len(queued))
	for _, snapshot := range a.session.Pendings() {
		bySession[snapshot.ID] = snapshot
	}
	out := make([]session.PendingSnapshot, 0, len(queued))
	for relayID, sessionID := range queued {
		snapshot, ok := bySession[sessionID]
		if !ok {
			continue
		}
		snapshot.ID = relayID
		out = append(out, snapshot)
	}
	return out
}

// OwnsSessionPending reports whether one session pending backs a queued
// relay approval. The dashboard hides such session rows and shows the
// relay id instead, so one guest never appears twice and accepts route
// through the agent (which sends rtc.Accept) instead of the session.
func (a *Agent) OwnsSessionPending(sessionID string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, entry := range a.approvals {
		if !entry.accepted && entry.sessionPending == sessionID {
			return true
		}
	}
	return false
}
