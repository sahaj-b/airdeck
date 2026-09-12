package relay

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/rtc"
)

// serveHost runs one /register socket: exactly one claim, then the
// accept/reject/answer control channel for its pendings.
func (h *Hub) serveHost(conn *websocket.Conn, remoteIP string) {
	host := newHostConn(h, conn)
	armPongs(conn)
	go pumpWriter(conn, host.send, host.done, host.finishClose)
	go keepalive(conn, host.done)
	defer func() {
		host.finishClose()
		h.dropHost(host)
	}()
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		msgType, err := rtc.MessageType(data)
		if err != nil {
			continue
		}
		switch msgType {
		case rtc.MessageRegister:
			h.handleRegister(host, remoteIP, data)
		case rtc.MessageAccept:
			h.handleAccept(host, data)
		case rtc.MessageReject:
			h.handleReject(host, data)
		case rtc.MessageAnswer:
			h.handleAnswer(host, data)
		default:
			// Unknown host frames are ignored; the relay never invents
			// protocol on a misunderstood message.
		}
	}
}

// serveGuest runs one /join socket. The socket may carry several join
// flows in sequence (reject then immediate re-request), so the loop
// handles join and offer frames until the guest goes away.
func (h *Hub) serveGuest(conn *websocket.Conn) {
	guest := newGuestConn(h, conn)
	armPongs(conn)
	go pumpWriter(conn, guest.send, guest.done, guest.finishClose)
	go keepalive(conn, guest.done)
	defer func() {
		guest.finishClose()
		h.dropGuest(guest)
	}()
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		msgType, err := rtc.MessageType(data)
		if err != nil {
			continue
		}
		switch msgType {
		case rtc.MessageJoin:
			h.handleJoin(guest, data)
		case rtc.MessageOffer:
			h.handleGuestOffer(guest, data)
		default:
			// Unknown guest frames are ignored.
		}
	}
}

// handleRegister claims (or reclaims, or changes) one room code for the
// registering host. It also runs for a second register on the same socket
// so a dashboard code change needs no reconnect.
func (h *Hub) handleRegister(host *hostConn, remoteIP string, data []byte) {
	var register rtc.Register
	if err := json.Unmarshal(data, &register); err != nil {
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "invalid register message"})
		return
	}
	code := roomcode.Normalize(register.RoomCode)
	if err := roomcode.Validate(code); err != nil {
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "invalid room code"})
		return
	}
	// Installation keys are compared, never logged.
	if register.InstallationKey == "" {
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "missing installation key"})
		return
	}
	if IsReserved(code) && h.limited("reserved code "+code) {
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "room code is reserved"})
		return
	}
	if !h.registerLimits.Allow(remoteIP) && h.limited("registration rate limit for "+remoteIP) {
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "registration rate limited, retry shortly"})
		return
	}
	if active, err := h.store.ActiveForKey(register.InstallationKey); err == nil && active != "" && active != code {
		count, err := h.store.ChangeCount(register.InstallationKey, DayString(h.now()))
		if err != nil {
			log.Printf("relay: change count lookup failed: %v", err)
		} else if count >= MaxCodeChangesPerDay && h.limited("code-change cap for key") {
			host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "code change limit reached for today"})
			return
		}
	} else if err != nil {
		log.Printf("relay: active-claim lookup failed: %v", err)
	}
	result, err := h.store.Register(code, register.InstallationKey)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "room code is claimed by another installation"})
			return
		}
		log.Printf("relay: claim transaction failed: %v", err)
		host.enqueue(rtc.Conflict{Type: rtc.MessageConflict, Reason: "registration failed, retry shortly"})
		return
	}
	if result.ChangedFrom != "" {
		if err := h.store.RecordChange(register.InstallationKey, DayString(h.now())); err != nil {
			log.Printf("relay: record code change failed: %v", err)
		}
		log.Printf("relay: code change %s -> %s tombstoned", result.ChangedFrom, code)
		// The old code goes dark even if its socket lingers: drop any
		// active mapping that still points at this host's old code.
		h.mu.Lock()
		if old, ok := h.hosts[result.ChangedFrom]; ok && old == host {
			delete(h.hosts, result.ChangedFrom)
		}
		h.mu.Unlock()
	}
	host.key = register.InstallationKey
	host.approvalRequired = register.ApprovalRequired
	h.mu.Lock()
	if old, ok := h.hosts[host.code]; ok && old == host && host.code != code {
		delete(h.hosts, host.code)
	}
	if prev, ok := h.hosts[code]; ok && prev != host {
		// Same-key restart with overlapping sockets: the new socket wins.
		prev.finishClose()
	}
	host.code = code
	h.hosts[code] = host
	h.mu.Unlock()
	host.enqueue(rtc.Registered{
		Type:       rtc.MessageRegistered,
		RoomCode:   code,
		ICEServers: h.turn.Servers(requestContext()),
	})
}

// deadCode replies the single generic dead-code error. Unknown, retired,
// and offline-host codes serialize byte-identically: one relay path, no
// enumeration oracle.
func (g *guestConn) deadCode() {
	g.enqueue(rtc.RoomNotFoundError())
}

// handleJoin routes one guest join by normalized room code and mode.
func (h *Hub) handleJoin(guest *guestConn, data []byte) {
	var join rtc.Join
	if err := json.Unmarshal(data, &join); err != nil {
		guest.deadCode()
		return
	}
	code := roomcode.Normalize(join.RoomCode)
	if err := roomcode.Validate(code); err != nil {
		guest.deadCode()
		return
	}
	claim, err := h.store.Lookup(code)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("relay: claim lookup failed: %v", err)
		}
		guest.deadCode()
		return
	}
	if claim.Retired {
		guest.deadCode()
		return
	}
	h.mu.Lock()
	host, ok := h.hosts[code]
	h.mu.Unlock()
	if !ok {
		guest.deadCode()
		return
	}
	if !host.approvalRequired {
		h.joinOpen(host, guest, join)
		return
	}
	h.joinApproval(host, guest, join)
}

// joinOpen forwards an open-mode join plus its offer with a fresh
// relay-assigned correlation id. A missing offer in open mode still gets
// the generic dead-code error: a distinct error would turn the offer
// check into a live-code oracle, and our phone always offers here.
func (h *Hub) joinOpen(host *hostConn, guest *guestConn, join rtc.Join) {
	if join.Offer == "" {
		guest.deadCode()
		return
	}
	id, err := newID()
	if err != nil {
		guest.deadCode()
		return
	}
	h.mu.Lock()
	h.routes[id] = &route{guest: guest, open: true}
	h.mu.Unlock()
	host.enqueue(rtc.Join{
		Type:          rtc.MessageJoin,
		RoomCode:      roomcode.Normalize(join.RoomCode),
		CorrelationID: id,
		DisplayName:   join.DisplayName,
		ReconnectID:   join.ReconnectID,
		Offer:         join.Offer,
	})
}

// joinApproval queues an offer-less join as a pending and notifies both
// sides: the full entry to the host queue, the bare id to the guest.
func (h *Hub) joinApproval(host *hostConn, guest *guestConn, join rtc.Join) {
	id, err := newID()
	if err != nil {
		guest.deadCode()
		return
	}
	entry := &pending{
		id:           id,
		displayName:  join.DisplayName,
		reconnectID:  join.ReconnectID,
		waitingSince: h.now().UnixMilli(),
		guest:        guest,
		host:         host,
	}
	h.mu.Lock()
	h.pendings[id] = entry
	h.mu.Unlock()
	guest.mu.Lock()
	guest.pending[id] = entry
	guest.mu.Unlock()
	host.enqueue(rtc.Pending{
		Type:         rtc.MessagePending,
		PendingID:    id,
		DisplayName:  join.DisplayName,
		ReconnectID:  join.ReconnectID,
		WaitingSince: entry.waitingSince,
	})
	guest.enqueue(rtc.Pending{Type: rtc.MessagePending, PendingID: id})
}

// handleGuestOffer forwards a post-accept SDP offer with a fresh
// correlation id the host echoes on its answer.
func (h *Hub) handleGuestOffer(guest *guestConn, data []byte) {
	var offer rtc.Offer
	if err := json.Unmarshal(data, &offer); err != nil || offer.SDP == "" {
		return
	}
	guest.mu.Lock()
	var entry *pending
	if offer.PendingID != "" {
		entry = guest.pending[offer.PendingID]
	} else {
		for _, owned := range guest.pending {
			if entry != nil {
				entry = nil
				break
			}
			entry = owned
		}
	}
	guest.mu.Unlock()
	if entry == nil {
		return
	}
	h.mu.Lock()
	if _, ok := h.pendings[entry.id]; !ok {
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()
	id, err := newID()
	if err != nil {
		return
	}
	h.mu.Lock()
	h.routes[id] = &route{guest: guest, pendingID: entry.id, open: false}
	h.mu.Unlock()
	entry.host.enqueue(rtc.Offer{
		Type:          rtc.MessageOffer,
		PendingID:     entry.id,
		CorrelationID: id,
		SDP:           offer.SDP,
	})
}

// handleAccept releases one queued pending toward slot assignment: the
// guest gets accepted plus TURN creds and answers with its offer.
func (h *Hub) handleAccept(host *hostConn, data []byte) {
	var accept rtc.Accept
	if err := json.Unmarshal(data, &accept); err != nil || accept.PendingID == "" {
		return
	}
	h.mu.Lock()
	entry, ok := h.pendings[accept.PendingID]
	h.mu.Unlock()
	if !ok || entry.host != host {
		host.enqueue(rtc.PendingGoneError())
		return
	}
	entry.guest.enqueue(rtc.Accepted{
		Type:       rtc.MessageAccepted,
		ICEServers: h.turn.Servers(requestContext()),
	})
}

// handleReject drops one queued pending. The guest returns to the join
// screen and may immediately re-request on the same socket.
func (h *Hub) handleReject(host *hostConn, data []byte) {
	var reject rtc.Reject
	if err := json.Unmarshal(data, &reject); err != nil || reject.PendingID == "" {
		return
	}
	h.mu.Lock()
	entry, ok := h.pendings[reject.PendingID]
	if ok {
		delete(h.pendings, reject.PendingID)
	}
	h.mu.Unlock()
	if !ok || entry.host != host {
		host.enqueue(rtc.PendingGoneError())
		return
	}
	entry.guest.mu.Lock()
	delete(entry.guest.pending, entry.id)
	entry.guest.mu.Unlock()
	entry.guest.enqueue(rtc.Rejected{Type: rtc.MessageRejected, Reason: reject.Reason})
}

// handleAnswer routes one SDP answer by its echoed correlation id. Open
// flows complete as joined; approval flows complete as a forwarded answer
// and evaporate the pending: signaling is done, the guest closes its
// socket, and post-establishment state is the host PC's job.
func (h *Hub) handleAnswer(host *hostConn, data []byte) {
	var answer rtc.Answer
	if err := json.Unmarshal(data, &answer); err != nil || answer.CorrelationID == "" || answer.SDP == "" {
		return
	}
	h.mu.Lock()
	found, ok := h.routes[answer.CorrelationID]
	if ok {
		delete(h.routes, answer.CorrelationID)
	}
	var entry *pending
	if ok && !found.open {
		entry, _ = h.pendings[found.pendingID]
		if entry != nil {
			delete(h.pendings, found.pendingID)
		}
	}
	h.mu.Unlock()
	if !ok {
		return
	}
	if found.open {
		found.guest.enqueue(rtc.Joined{
			Type:       rtc.MessageJoined,
			Answer:     answer.SDP,
			ICEServers: h.turn.Servers(requestContext()),
		})
		return
	}
	found.guest.enqueue(rtc.Answer{
		Type:          rtc.MessageAnswer,
		CorrelationID: answer.CorrelationID,
		SDP:           answer.SDP,
	})
	if entry != nil {
		entry.guest.mu.Lock()
		delete(entry.guest.pending, entry.id)
		entry.guest.mu.Unlock()
	}
}

// dropHost removes one host's live routing and tells its pre-establishment
// pendings the peer is gone. Durable claims survive: a restart
// re-registers the same code. Post-establishment guests never hear
// peer.left; their signaling already completed.
func (h *Hub) dropHost(host *hostConn) {
	h.mu.Lock()
	if current, ok := h.hosts[host.code]; ok && current == host {
		delete(h.hosts, host.code)
	}
	var orphaned []*pending
	for id, entry := range h.pendings {
		if entry.host == host {
			delete(h.pendings, id)
			orphaned = append(orphaned, entry)
		}
	}
	h.mu.Unlock()
	for _, entry := range orphaned {
		entry.guest.mu.Lock()
		delete(entry.guest.pending, entry.id)
		entry.guest.mu.Unlock()
		entry.guest.enqueue(rtc.PeerLeft{Type: rtc.MessagePeerLeft, PendingID: entry.id})
	}
}

// dropGuest evaporates one guest's pendings and routes with no host
// notification. The host learns lazily: its next accept/reject for the
// id gets pending_gone and the dashboard reconciles via admin state.
func (h *Hub) dropGuest(guest *guestConn) {
	guest.mu.Lock()
	owned := make([]*pending, 0, len(guest.pending))
	for _, entry := range guest.pending {
		owned = append(owned, entry)
	}
	guest.pending = make(map[string]*pending)
	guest.mu.Unlock()
	h.mu.Lock()
	for _, entry := range owned {
		delete(h.pendings, entry.id)
	}
	for id, found := range h.routes {
		if found.guest == guest {
			delete(h.routes, id)
		}
	}
	h.mu.Unlock()
}

// remoteIP strips the port for rate-limit keys.
func remoteIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}
