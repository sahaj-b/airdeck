package httpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/transport"
)

const (
	pendingTTL      = 60 * time.Second
	maxPublishBytes = 512 * 1024
)

var (
	errPendingNotFound = errors.New("publish request not found")
	errPendingBusy     = errors.New("publish request is being processed")
)

type pendingEntry struct {
	ID         string
	Document   layout.Document
	PhoneID    string
	PhoneName  string
	expiresAt  time.Time
	timer      *time.Timer
	processing bool
}

type PendingStore struct {
	mu      sync.Mutex
	entries map[string]*pendingEntry
	server  *Server
}

func newPendingStore(server *Server) *PendingStore {
	return &PendingStore{entries: make(map[string]*pendingEntry), server: server}
}

func generatePendingID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate publish id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

func (p *PendingStore) Create(phoneID string, phoneName string, doc layout.Document) (*pendingEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id, err := generatePendingID()
	if err != nil {
		return nil, err
	}
	for {
		if _, exists := p.entries[id]; !exists {
			break
		}
		id, err = generatePendingID()
		if err != nil {
			return nil, err
		}
	}
	entry := &pendingEntry{
		ID: id, Document: doc, PhoneID: phoneID, PhoneName: phoneName,
		expiresAt: time.Now().Add(pendingTTL),
	}
	entry.timer = time.AfterFunc(pendingTTL, func() {
		p.expire(entry)
	})
	p.entries[id] = entry
	return entry, nil
}

func (p *PendingStore) Claim(id string) (*pendingEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.entries[id]
	if !ok {
		return nil, errPendingNotFound
	}
	if entry.processing {
		return nil, errPendingBusy
	}
	entry.processing = true
	if entry.timer != nil {
		entry.timer.Stop()
	}
	return entry, nil
}

func (p *PendingStore) Complete(id string, entry *pendingEntry) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	current, ok := p.entries[id]
	if !ok || current != entry || !entry.processing {
		return false
	}
	if entry.timer != nil {
		entry.timer.Stop()
	}
	delete(p.entries, id)
	return true
}

func (p *PendingStore) Release(id string, entry *pendingEntry) {
	p.mu.Lock()
	defer p.mu.Unlock()
	current, ok := p.entries[id]
	if !ok || current != entry || !entry.processing {
		return
	}
	entry.processing = false
	if entry.timer != nil {
		entry.timer.Reset(time.Until(entry.expiresAt))
	}
}

func (p *PendingStore) Remove(id string) (*pendingEntry, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry, ok := p.entries[id]
	if !ok {
		return nil, errPendingNotFound
	}
	if entry.processing {
		return nil, errPendingBusy
	}
	if entry.timer != nil {
		entry.timer.Stop()
	}
	delete(p.entries, id)
	return entry, nil
}

func (p *PendingStore) expire(entry *pendingEntry) {
	p.mu.Lock()
	current, ok := p.entries[entry.ID]
	if !ok || current != entry || entry.processing {
		p.mu.Unlock()
		return
	}
	delete(p.entries, entry.ID)
	p.mu.Unlock()
	// Notify phone of expiry.
	_ = p.server.sendPublishResult(entry.PhoneID, entry.ID, "expired")
}

func (s *Server) sendPublishResult(phoneID, id, status string) error {
	if s.options.Transport == nil {
		return errors.New("transport not configured")
	}
	return s.options.Transport.SendToPlayer(phoneID, protocol.PublishResult{Type: protocol.MessagePublishResult, ID: id, Status: status})
}

func (s *Server) notifyAdminPublishPending(entry *pendingEntry) {
	msg := protocol.PublishPending{Type: protocol.MessagePublishPending, ID: entry.ID, Document: entry.Document, PhoneID: entry.PhoneID, PhoneName: entry.PhoneName}
	s.broadcastAdmin(msg)
}

func (s *Server) handlePublishCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if !transport.SameOrigin(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPublishBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeErrorStatus(w, errors.New("publish body too large"), http.StatusRequestEntityTooLarge)
			return
		}
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	var req struct {
		PlayerID string          `json:"playerId"`
		Document json.RawMessage `json:"document"`
	}
	if err := json.Unmarshal(data, &req); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	if req.PlayerID == "" {
		writeErrorStatus(w, errors.New("playerId is required"), http.StatusBadRequest)
		return
	}
	player, ok := s.options.Session.Player(req.PlayerID)
	if !ok {
		writeErrorStatus(w, errors.New("player not found"), http.StatusNotFound)
		return
	}
	doc, err := layout.ValidateJSON(req.Document)
	if err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	entry, err := s.pending.Create(req.PlayerID, player.Name, doc)
	if err != nil {
		writeErrorStatus(w, err, http.StatusInternalServerError)
		return
	}
	s.notifyAdminPublishPending(entry)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending", "id": entry.ID})
}

func (s *Server) handlePublishCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if !transport.SameOrigin(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/layouts/publish/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	entry, err := s.pending.Remove(id)
	if err != nil {
		if errors.Is(err, errPendingBusy) {
			writeErrorStatus(w, err, http.StatusConflict)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	_ = s.sendPublishResult(entry.PhoneID, id, "cancelled")
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled", "id": id})
}

func (s *Server) handlePublishAccept(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	id := extractPublishID(r.URL.Path, "/api/admin/layouts/publish/", "/accept")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	entry, err := s.pending.Claim(id)
	if err != nil {
		if errors.Is(err, errPendingBusy) {
			writeErrorStatus(w, err, http.StatusConflict)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	defer s.pending.Release(id, entry)
	// Validate again before writing.
	if err := layout.ValidateDocument(entry.Document); err != nil {
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	err = s.options.Layouts.Create(entry.Document)
	if err != nil {
		if errors.Is(err, layout.ErrBuiltinProtected) {
			writeErrorStatus(w, err, http.StatusForbidden)
			return
		}
		if errors.Is(err, layout.ErrLayoutExists) {
			// Keep pending alive for rename flow.
			writeErrorStatus(w, err, http.StatusConflict)
			return
		}
		writeErrorStatus(w, err, http.StatusBadRequest)
		return
	}
	if !s.pending.Complete(id, entry) {
		writeErrorStatus(w, errors.New("publish request is no longer pending"), http.StatusConflict)
		return
	}
	_ = s.sendPublishResult(entry.PhoneID, id, "accepted")
	s.options.Session.ReconcileLayouts()
	s.broadcastAdminState()
	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted", "id": id})
}

func (s *Server) handlePublishDecline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	id := extractPublishID(r.URL.Path, "/api/admin/layouts/publish/", "/decline")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	entry, err := s.pending.Remove(id)
	if err != nil {
		if errors.Is(err, errPendingBusy) {
			writeErrorStatus(w, err, http.StatusConflict)
		} else {
			http.NotFound(w, r)
		}
		return
	}
	_ = s.sendPublishResult(entry.PhoneID, id, "declined")
	writeJSON(w, http.StatusOK, map[string]string{"status": "declined", "id": id})
}

func extractPublishID(path, prefix, suffix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	if !strings.HasSuffix(rest, suffix) {
		return ""
	}
	id := strings.TrimSuffix(rest, suffix)
	if id == "" || strings.Contains(id, "/") {
		return ""
	}
	return id
}
