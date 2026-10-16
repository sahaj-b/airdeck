package session

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/layout"
)

func TestApprovalQueuesPendingWhenRequired(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	admission, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want ErrApprovalPending", err)
	}
	if admission.PendingID == "" || admission.PendingWait == nil {
		t.Fatal("pending admission must carry PendingID and PendingWait")
	}
	if players := session.Players(); len(players) != 0 {
		t.Fatalf("pending created %d players, want 0", len(players))
	}
	pendings := session.Pendings()
	if len(pendings) != 1 || pendings[0].ID != admission.PendingID || pendings[0].DisplayName != "Phone" {
		t.Fatalf("pendings = %+v, want one Phone entry", pendings)
	}
	if pendings[0].WaitingSince.IsZero() {
		t.Fatal("pending WaitingSince was not set")
	}
}

func TestAcceptPendingAdmitsPlayer(t *testing.T) {
	session, factory := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	queued, err := session.Admit(session.Code(), "Phone", "", "xbox-default", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	admission, err := session.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatalf("AcceptPending: %v", err)
	}
	if admission.Player.Slot != 0 || admission.Player.Name != "Phone" {
		t.Fatalf("accepted player = %+v, want slot 0 Phone", admission.Player)
	}
	if players := session.Players(); len(players) != 1 {
		t.Fatalf("players = %d, want 1", len(players))
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("pendings = %d after accept, want 0", len(pendings))
	}
	factory.mu.Lock()
	devices := len(factory.devices)
	factory.mu.Unlock()
	if devices != 1 {
		t.Fatalf("accept created %d devices, want 1", devices)
	}
	select {
	case outcome := <-queued.PendingWait:
		if outcome.Err != nil || outcome.Admission.Player.ID != admission.Player.ID {
			t.Fatalf("waiter outcome = %+v, want accepted admission", outcome)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waiter never received the accept")
	}
	welcome := BuildWelcome(admission.Player, mustTestLayouts(t, session), 60)
	if welcome.PlayerID != admission.Player.ID || welcome.Slot != 0 || welcome.ProtocolVersion != 1 || welcome.FrameSize != 20 {
		t.Fatalf("welcome = %+v, want pre-built admit result", welcome)
	}
}

func mustTestLayouts(t *testing.T, session *Session) *layout.Library {
	t.Helper()
	session.mu.RLock()
	defer session.mu.RUnlock()
	return session.layouts
}

func TestRejectPendingEvaporates(t *testing.T) {
	session, factory := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	queued, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	if err := session.RejectPending(queued.PendingID, "party is full"); err != nil {
		t.Fatalf("RejectPending: %v", err)
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("pendings = %d after reject, want 0", len(pendings))
	}
	if players := session.Players(); len(players) != 0 {
		t.Fatalf("reject created %d players, want 0", len(players))
	}
	factory.mu.Lock()
	devices := len(factory.devices)
	factory.mu.Unlock()
	if devices != 0 {
		t.Fatalf("reject created %d devices, want 0", devices)
	}
	select {
	case outcome := <-queued.PendingWait:
		if !errors.Is(outcome.Err, ErrDeclined) || outcome.Reason != "party is full" {
			t.Fatalf("waiter outcome = %+v, want declined with reason", outcome)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waiter never received the reject")
	}
	if err := session.RejectPending(queued.PendingID, ""); !errors.Is(err, ErrPendingNotFound) {
		t.Fatalf("second reject error = %v, want ErrPendingNotFound", err)
	}
	if _, err := session.AcceptPending(queued.PendingID); !errors.Is(err, ErrPendingNotFound) {
		t.Fatalf("accept-after-reject error = %v, want ErrPendingNotFound", err)
	}
}

func TestReclaimSkipsApproval(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	open, err := session.Admit(session.Code(), "Player", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Disconnect(open.Player.ID, open.Player.Generation); err != nil {
		t.Fatal(err)
	}
	session.SetApprovalRequired(true)
	reclaimed, err := session.Admit(session.Code(), "", open.Player.ReconnectID, "", nil, nil)
	if err != nil {
		t.Fatalf("reclaim with approval on: %v", err)
	}
	if !reclaimed.Reconnected || reclaimed.PendingID != "" {
		t.Fatalf("reclaim = %+v, want direct reconnect without pending", reclaimed)
	}
	if reclaimed.Player.Slot != open.Player.Slot || reclaimed.Player.ID != open.Player.ID {
		t.Fatalf("reclaim changed identity: %+v vs %+v", reclaimed.Player, open.Player)
	}
	if reclaimed.Player.Generation != open.Player.Generation+2 {
		t.Fatalf("generation = %d, want %d", reclaimed.Player.Generation, open.Player.Generation+2)
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("reclaim queued %d pendings, want 0", len(pendings))
	}
}

func TestExpiredRejoinQueuesAsNew(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := New(library, device.NewManager(&sessionFakeFactory{}), 10*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	sess.SetApprovalRequired(true)
	open, err := func() (Admission, error) {
		sess.SetApprovalRequired(false)
		defer sess.SetApprovalRequired(true)
		return sess.Admit(sess.Code(), "Player", "", "", nil, nil)
	}()
	if err != nil {
		t.Fatal(err)
	}
	if err := sess.Disconnect(open.Player.ID, open.Player.Generation); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	rejoin, err := sess.Admit(sess.Code(), "Player", open.Player.ReconnectID, "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("expired rejoin error = %v, want pending-as-new", err)
	}
	if rejoin.Reconnected || rejoin.PendingID == "" {
		t.Fatalf("expired rejoin = %+v, want fresh pending", rejoin)
	}
	admission, err := sess.AcceptPending(rejoin.PendingID)
	if err != nil {
		t.Fatal(err)
	}
	if admission.Player.ID == open.Player.ID {
		t.Fatal("expired rejoin reused the dead player id")
	}
	if admission.Player.Slot != open.Player.Slot {
		t.Fatalf("expired rejoin slot = %d, want freed slot %d", admission.Player.Slot, open.Player.Slot)
	}
}

func TestAutoAcceptWhenApprovalOff(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	admission, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
	if err != nil || admission.PendingID != "" || admission.PendingWait != nil {
		t.Fatalf("auto-accept = %+v, %v; want direct admission", admission, err)
	}
}

func TestNewSessionKeepsCodeAndClearsPendings(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	before := session.Code()
	if before == "" {
		t.Fatal("session started without a code")
	}
	session.SetApprovalRequired(true)
	queued, err := session.Admit(before, "Phone", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	if _, err := session.Admit(before, "Second", "", "", func(any) error { return nil }, func() {}); !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("second queue error = %v, want pending", err)
	}
	// One admitted player plus two pendings: reset must clear all three.
	session.SetApprovalRequired(false)
	if _, err := session.Admit(before, "Open", "", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	session.SetApprovalRequired(true)
	if err := session.NewSession(); err != nil {
		t.Fatal(err)
	}
	if got := session.Code(); got != before {
		t.Fatalf("code after reset = %q, want kept %q", got, before)
	}
	if players := session.Players(); len(players) != 0 {
		t.Fatalf("reset left %d players", len(players))
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("reset left %d pendings", len(pendings))
	}
	select {
	case outcome := <-queued.PendingWait:
		if !errors.Is(outcome.Err, ErrPendingNotFound) {
			t.Fatalf("evaporated waiter outcome = %+v, want pending_gone", outcome)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("reset never woke the pending waiter")
	}
	// The kept code still admits after reset.
	session.SetApprovalRequired(false)
	if _, err := session.Admit(before, "After", "", "", nil, nil); err != nil {
		t.Fatalf("admit after reset with kept code: %v", err)
	}
}

func TestConcurrentAdmitsNeverShareSlot(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	const n = MaxPlayers
	var wg sync.WaitGroup
	slots := make(chan int, n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			admission, err := session.Admit(session.Code(), "", "", "", nil, nil)
			if err != nil {
				errs <- err
				return
			}
			slots <- admission.Player.Slot
		}()
	}
	wg.Wait()
	close(slots)
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent admit: %v", err)
	}
	seen := make(map[int]bool)
	for slot := range slots {
		if seen[slot] {
			t.Fatalf("slot %d admitted twice", slot)
		}
		seen[slot] = true
	}
	if len(seen) != n {
		t.Fatalf("admitted %d unique slots, want %d", len(seen), n)
	}
}

func TestConcurrentAcceptsNeverShareSlot(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	ids := make([]string, 0, MaxPlayers)
	for i := 0; i < MaxPlayers; i++ {
		queued, err := session.Admit(session.Code(), "", "", "", nil, nil)
		if !errors.Is(err, ErrApprovalPending) {
			t.Fatalf("queue %d: %v", i, err)
		}
		ids = append(ids, queued.PendingID)
	}
	var wg sync.WaitGroup
	slots := make(chan int, MaxPlayers)
	errs := make(chan error, MaxPlayers)
	for _, id := range ids {
		wg.Add(1)
		go func(pendingID string) {
			defer wg.Done()
			admission, err := session.AcceptPending(pendingID)
			if err != nil {
				errs <- err
				return
			}
			slots <- admission.Player.Slot
		}(id)
	}
	wg.Wait()
	close(slots)
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent accept: %v", err)
	}
	seen := make(map[int]bool)
	for slot := range slots {
		if seen[slot] {
			t.Fatalf("slot %d accepted twice", slot)
		}
		seen[slot] = true
	}
	if len(seen) != MaxPlayers {
		t.Fatalf("accepted %d unique slots, want %d", len(seen), MaxPlayers)
	}
}

func TestAdmissionErrorMapping(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{ErrInvalidCode, "invalid_code"},
		{ErrRoomNotFound, "room_not_found"},
		{ErrApprovalPending, "pending"},
		{ErrPendingNotFound, "pending_gone"},
		{ErrDeclined, "declined"},
		{ErrJoinsClosed, "joins_closed"},
		{ErrSessionFull, "session_full"},
		{ErrPendingsFull, "session_full"},
		{ErrInvalidReconnect, "invalid_reconnect"},
		{errors.New("boom"), "device_error"},
	}
	for _, c := range cases {
		if code, _ := AdmissionError(c.err); code != c.code {
			t.Errorf("AdmissionError(%v) code = %q, want %q", c.err, code, c.code)
		}
	}
}

// A full approval queue is not a full session: slots can be free while the
// host is not answering, and the guest-facing message says so.
func TestPendingQueueFull(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	for i := 0; i < MaxPendings; i++ {
		_, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
		if !errors.Is(err, ErrApprovalPending) {
			t.Fatalf("queued join %d error = %v, want pending", i, err)
		}
	}
	if _, err := session.Admit(session.Code(), "Phone", "", "", nil, nil); !errors.Is(err, ErrPendingsFull) {
		t.Fatalf("overflow error = %v, want ErrPendingsFull", err)
	}
	if code, message := AdmissionError(ErrPendingsFull); code != "session_full" || message != "Too many join requests are waiting for host approval." {
		t.Fatalf("overflow mapping = %q, %q", code, message)
	}
	// Draining one entry frees a queue slot.
	session.RemovePending(session.Pendings()[0].ID)
	if _, err := session.Admit(session.Code(), "Phone", "", "", nil, nil); !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("join after drain error = %v, want pending", err)
	}
}

func TestRemovePendingEvaporates(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	queued, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	session.RemovePending(queued.PendingID)
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("pendings = %d after evaporate, want 0", len(pendings))
	}
	select {
	case outcome := <-queued.PendingWait:
		if !errors.Is(outcome.Err, ErrPendingNotFound) {
			t.Fatalf("evaporate outcome = %+v, want pending_gone", outcome)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("evaporate never woke the waiter")
	}
	// Double evaporate is a no-op, never a panic.
	session.RemovePending(queued.PendingID)
}

func TestAcceptWhenFullKeepsPending(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	queued, err := session.Admit(session.Code(), "Waiter", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("queue error = %v, want pending", err)
	}
	// Fill every slot around the queued pending via direct admits.
	session.SetApprovalRequired(false)
	var fillers []Admission
	for i := 0; i < MaxPlayers; i++ {
		admission, err := session.Admit(session.Code(), "", "", "", nil, nil)
		if err != nil {
			t.Fatalf("fill %d: %v", i, err)
		}
		fillers = append(fillers, admission)
	}
	if _, err := session.AcceptPending(queued.PendingID); !errors.Is(err, ErrSessionFull) {
		t.Fatalf("accept-when-full error = %v, want ErrSessionFull", err)
	}
	if pendings := session.Pendings(); len(pendings) != 1 {
		t.Fatalf("full accept dropped the pending, pendings = %d", len(pendings))
	}
	if err := session.Kick(fillers[0].Player.ID); err != nil {
		t.Fatal(err)
	}
	admission, err := session.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatalf("accept after free: %v", err)
	}
	if admission.Player.Slot != 0 {
		t.Fatalf("accepted slot = %d, want freed 0", admission.Player.Slot)
	}
}

func TestAcceptPendingRenumbersFallbackName(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	queued, err := session.Admit(session.Code(), "", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	if pendings := session.Pendings(); len(pendings) != 1 || pendings[0].DisplayName != "Player" {
		t.Fatalf("queued display = %+v, want Player fallback", session.Pendings())
	}
	admission, err := session.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatal(err)
	}
	if admission.Player.Name != "Player 1" {
		t.Fatalf("accepted name = %q, want slot-based Player 1", admission.Player.Name)
	}
	// An explicit name survives accept untouched, even one that looks
	// like a fallback.
	queued, err = session.Admit(session.Code(), "Player", "", "", nil, nil)
	if !errors.Is(err, ErrApprovalPending) {
		t.Fatalf("Admit error = %v, want pending", err)
	}
	admission, err = session.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatal(err)
	}
	if admission.Player.Name != "Player" || admission.Player.Slot != 1 {
		t.Fatalf("accepted = %+v, want explicit Player kept in slot 1", admission.Player)
	}
}

func TestApprovalDoesNotQueueInvalidCodeOrClosedJoins(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	session.SetApprovalRequired(true)
	if _, err := session.Admit("WRONG1", "Phone", "", "", nil, nil); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("bad code error = %v, want ErrInvalidCode", err)
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("bad code queued %d pendings, want 0", len(pendings))
	}
	session.SetAcceptingJoins(false)
	if _, err := session.Admit(session.Code(), "Phone", "", "", nil, nil); !errors.Is(err, ErrJoinsClosed) {
		t.Fatalf("closed joins error = %v, want ErrJoinsClosed", err)
	}
	if pendings := session.Pendings(); len(pendings) != 0 {
		t.Fatalf("closed joins queued %d pendings, want 0", len(pendings))
	}
}

func TestAttachTransportSwapsSenderOnly(t *testing.T) {
	session, _ := newTestSession(t)
	defer session.Close()
	admission, err := session.Admit(session.Code(), "Phone", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	attached := false
	if err := session.AttachTransport(admission.Player.ID, admission.Player.Generation, func(any) error { attached = true; return nil }, func() {}); err != nil {
		t.Fatalf("AttachTransport: %v", err)
	}
	session.mu.RLock()
	stored := session.players[admission.Player.ID]
	session.mu.RUnlock()
	if stored == nil || stored.Send == nil || stored.Close == nil {
		t.Fatal("attached transport was not installed on the player")
	}
	if err := stored.Send(nil); err != nil || !attached {
		t.Fatal("attached sender was not installed")
	}
	if players := session.Players(); len(players) != 1 {
		t.Fatalf("attach minted players: %d, want 1", len(players))
	}
	if err := session.AttachTransport(admission.Player.ID, admission.Player.Generation+99, nil, nil); !errors.Is(err, ErrGeneration) {
		t.Fatalf("wrong generation error = %v, want ErrGeneration", err)
	}
	if err := session.AttachTransport("missing", 1, nil, nil); !errors.Is(err, ErrPlayerNotFound) {
		t.Fatalf("unknown player error = %v, want ErrPlayerNotFound", err)
	}
}
