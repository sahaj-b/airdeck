package relay

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net"

	"github.com/gorilla/websocket"
	"github.com/sahaj-b/airdeck/internal/roomcode"
	"github.com/sahaj-b/airdeck/internal/rtc"
)

// serveHost runs one /register socket.
func (h *Hub) serveHost(conn *websocket.Conn, remoteIP string) {
	host := newHostConn(conn)
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

// serveGuest runs one /join socket. One socket can carry several join
// flows in sequence, so the loop handles join and offer frames.
func (h *Hub) serveGuest(conn *websocket.Conn) {
	guest := newGuestConn(conn)
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

// handleRegister claims, reclaims, or changes one room code for the host.
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

		h.mu.Lock()
		if old, ok := h.hosts[result.ChangedFrom]; ok && old == host {
			delete(h.hosts, result.ChangedFrom)
		}
		h.mu.Unlock()
	}
	h.mu.Lock()
	host.approvalRequired = register.ApprovalRequired
	if old, ok := h.hosts[host.code]; ok && old == host && host.code != code {
		delete(h.hosts, host.code)
	}
	if prev, ok := h.hosts[code]; ok && prev != host {
		prev.finishClose()
	}
	host.code = code
	h.hosts[code] = host
	h.mu.Unlock()
	host.enqueue(rtc.Registered{
		Type:       rtc.MessageRegistered,
		RoomCode:   code,
		ICEServers: h.turn.Servers(context.Background()),
	})
}

// deadCode replies the single generic error for unknown, retired, and
// offline-host codes.
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
		log.Printf("relay: join room %s -> error (unknown code)", code)
		guest.deadCode()
		return
	}
	if claim.Retired {
		log.Printf("relay: join room %s -> error (retired code)", code)
		guest.deadCode()
		return
	}
	h.mu.Lock()
	host, ok := h.hosts[code]
	approval := ok && host.approvalRequired
	h.mu.Unlock()
	if !ok {
		log.Printf("relay: join room %s -> error (host offline)", code)
		guest.deadCode()
		return
	}
	if !approval {
		h.joinOpen(host, guest, join)
		return
	}
	h.joinApproval(host, guest, join)
}

// joinOpen forwards an open-mode join plus its offer. A missing offer
// still gets the generic error so the check cannot become a live-code oracle.
func (h *Hub) joinOpen(host *hostConn, guest *guestConn, join rtc.Join) {
	if join.Offer == "" {
		log.Printf("relay: join room %s -> error (missing offer)", roomcode.Normalize(join.RoomCode))
		guest.deadCode()
		return
	}
	id, err := newID()
	if err != nil {
		guest.deadCode()
		return
	}
	h.mu.Lock()
	h.routes[id] = &route{guest: guest, host: host, open: true}
	h.mu.Unlock()
	host.enqueue(rtc.Join{
		Type:          rtc.MessageJoin,
		RoomCode:      roomcode.Normalize(join.RoomCode),
		CorrelationID: id,
		DisplayName:   join.DisplayName,
		ReconnectID:   join.ReconnectID,
		Offer:         join.Offer,
	})
	log.Printf("relay: join room %s -> open forwarded", roomcode.Normalize(join.RoomCode))
}

// joinApproval queues an offer-less join as a pending.
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
	log.Printf("relay: join room %s -> pending %s", roomcode.Normalize(join.RoomCode), id)
}

// handleGuestOffer forwards a post-accept offer.
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
	h.routes[id] = &route{guest: guest, host: entry.host, pendingID: entry.id, open: false}
	h.mu.Unlock()
	entry.host.enqueue(rtc.Offer{
		Type:          rtc.MessageOffer,
		PendingID:     entry.id,
		CorrelationID: id,
		SDP:           offer.SDP,
	})
	log.Printf("relay: offer room %s -> forwarded (pending %s)", entry.host.code, entry.id)
}

// handleAccept releases one queued pending toward slot assignment.
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
		ICEServers: h.turn.Servers(context.Background()),
	})
}

// handleReject drops one queued pending.
func (h *Hub) handleReject(host *hostConn, data []byte) {
	var reject rtc.Reject
	if err := json.Unmarshal(data, &reject); err != nil || reject.PendingID == "" {
		return
	}
	h.mu.Lock()
	entry, ok := h.pendings[reject.PendingID]
	if !ok || entry.host != host {
		h.mu.Unlock()
		host.enqueue(rtc.PendingGoneError())
		return
	}
	delete(h.pendings, reject.PendingID)
	h.mu.Unlock()
	entry.guest.mu.Lock()
	delete(entry.guest.pending, entry.id)
	entry.guest.mu.Unlock()
	entry.guest.enqueue(rtc.Rejected{Type: rtc.MessageRejected, Reason: reject.Reason})
}

// handleAnswer routes one SDP answer by its echoed correlation id.
func (h *Hub) handleAnswer(host *hostConn, data []byte) {
	var answer rtc.Answer
	if err := json.Unmarshal(data, &answer); err != nil || answer.CorrelationID == "" || answer.SDP == "" {
		return
	}
	h.mu.Lock()
	found, ok := h.routes[answer.CorrelationID]
	if !ok {
		h.mu.Unlock()
		return
	}
	if found.guest == nil || found.host == nil || found.host != host {
		delete(h.routes, answer.CorrelationID)
		h.mu.Unlock()
		return
	}
	delete(h.routes, answer.CorrelationID)
	code := ""
	if found.host != nil {
		code = found.host.code
	}
	var entry *pending
	if !found.open {
		entry, _ = h.pendings[found.pendingID]
		if entry != nil {
			delete(h.pendings, found.pendingID)
		}
	}
	h.mu.Unlock()
	if found.open {
		found.guest.enqueue(rtc.Joined{
			Type:       rtc.MessageJoined,
			Answer:     answer.SDP,
			ICEServers: h.turn.Servers(context.Background()),
		})
		log.Printf("relay: answer room %s -> forwarded (open)", code)
		return
	}
	found.guest.enqueue(rtc.Answer{
		Type:          rtc.MessageAnswer,
		CorrelationID: answer.CorrelationID,
		SDP:           answer.SDP,
	})
	log.Printf("relay: answer room %s -> forwarded (approval)", code)
	if entry != nil {
		entry.guest.mu.Lock()
		delete(entry.guest.pending, entry.id)
		entry.guest.mu.Unlock()
	}
}

// dropHost removes one host's live routing and fails its pre-establishment
// pendings. Durable claims survive; a restart re-registers the same code.
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
	for id, found := range h.routes {
		if found.host == host {
			delete(h.routes, id)
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

// dropGuest evaporates one guest's pendings and routes. The host learns
// lazily via pending_gone on its next accept/reject.
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
