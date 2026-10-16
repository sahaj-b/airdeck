package online

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/rtc"
	"github.com/sahaj-b/airdeck/internal/rtchost"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

// fakeRelay is a minimal /register + /health relay stand-in: it answers
// one register with registered (STUN-only) or conflict, records host
// answers/accepts/rejects, and lets the test inject join/pending/offer
// forwards plus drop the socket to simulate network failure.
type fakeRelay struct {
	t          *testing.T
	conflict   bool
	mu         sync.Mutex
	host       *websocket.Conn
	registers  int
	answers    []rtc.Answer
	accepts    []rtc.Accept
	rejects    []rtc.Reject
	inject     chan []byte
	drop       chan struct{}
	answerWait chan struct{}
}

func newFakeRelay(t *testing.T, conflict bool) (*fakeRelay, *httptest.Server) {
	t.Helper()
	relay := &fakeRelay{t: t, conflict: conflict, inject: make(chan []byte, 16), drop: make(chan struct{}, 1), answerWait: make(chan struct{}, 16)}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		msgType, err := rtc.MessageType(data)
		if err != nil || msgType != rtc.MessageRegister {
			t.Errorf("relay got first message %q, want register", msgType)
			return
		}
		relay.mu.Lock()
		relay.registers++
		relay.host = conn
		relay.mu.Unlock()
		if relay.conflict {
			_ = conn.WriteJSON(rtc.Conflict{Type: rtc.MessageConflict, Reason: "room code is claimed by another installation"})
			return
		}
		if err := conn.WriteJSON(rtc.Registered{
			Type: rtc.MessageRegistered, RoomCode: "TEST22",
			// Empty bundle in tests: host-candidate-only gathering
			// completes in milliseconds with no STUN round-trip.
			ICEServers: []rtc.ICEServer{},
		}); err != nil {
			return
		}
		_ = conn.SetReadDeadline(time.Time{})
		go func() {
			for {
				_, data, err := conn.ReadMessage()
				if err != nil {
					return
				}
				msgType, err := rtc.MessageType(data)
				if err != nil {
					continue
				}
				relay.mu.Lock()
				switch msgType {
				case rtc.MessageAnswer:
					var answer rtc.Answer
					if err := json.Unmarshal(data, &answer); err == nil {
						relay.answers = append(relay.answers, answer)
						select {
						case relay.answerWait <- struct{}{}:
						default:
						}
					}
				case rtc.MessageAccept:
					var accept rtc.Accept
					if err := json.Unmarshal(data, &accept); err == nil {
						relay.accepts = append(relay.accepts, accept)
					}
				case rtc.MessageReject:
					var reject rtc.Reject
					if err := json.Unmarshal(data, &reject); err == nil {
						relay.rejects = append(relay.rejects, reject)
					}
				}
				relay.mu.Unlock()
			}
		}()
		for {
			select {
			case data := <-relay.inject:
				_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
					return
				}
			case <-relay.drop:
				return
			}
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return relay, server
}

func (r *fakeRelay) send(t *testing.T, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case r.inject <- data:
	case <-time.After(2 * time.Second):
		t.Fatal("relay inject blocked: host socket gone")
	}
}

func (r *fakeRelay) waitAnswers(t *testing.T, n int) []rtc.Answer {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		got := len(r.answers)
		r.mu.Unlock()
		if got >= n {
			r.mu.Lock()
			defer r.mu.Unlock()
			return append([]rtc.Answer(nil), r.answers...)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("relay got %d answers, want %d", len(r.answers), n)
	return nil
}

func registerURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/register"
}

type agentFixture struct {
	agent   *Agent
	session *session.Session
	peers   *rtchost.PeerManager
	changes chan struct{}
}

func newAgentFixture(t *testing.T, server *httptest.Server, approval bool) *agentFixture {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := session.New(library, device.NewManager(&fakeFactory{}), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	sess.SetApprovalRequired(approval)
	// Production sets session and agent from one config RoomCode; the
	// fixture must match or every Admit fails the code check.
	sess.SetCode("TEST22")
	handler := input.NewHandler(sess)
	peers := rtchost.New(sess, handler, library, 60)
	changes := make(chan struct{}, 16)
	agent := New(Options{
		ApprovalRequired: approval, RelayURL: registerURL(server),
		Session: sess, Peers: peers,
		OnStateChange: func() {
			select {
			case changes <- struct{}{}:
			default:
			}
		},
	})
	t.Cleanup(agent.Close)
	return &agentFixture{agent: agent, session: sess, peers: peers, changes: changes}
}

type fakeDevice struct{}

func (fakeDevice) Apply(uinput.State) error { return nil }
func (fakeDevice) Neutralize() error        { return nil }
func (fakeDevice) Destroy() error           { return nil }
func (fakeDevice) Syspath() (string, error) { return "fake", nil }

type fakeFactory struct{}

func (*fakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	return fakeDevice{}, nil
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestRegisterSuccessBecomesReachable(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, false)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() && fix.agent.Conflict() == "" })
	relay.mu.Lock()
	registers := relay.registers
	relay.mu.Unlock()
	if registers != 1 {
		t.Fatalf("registers = %d, want 1", registers)
	}
}

func TestConflictStopsLoopWithoutRetry(t *testing.T) {
	relay, server := newFakeRelay(t, true)
	fix := newAgentFixture(t, server, false)
	fix.agent.Start()
	waitFor(t, "conflict", func() bool { return fix.agent.Conflict() != "" })
	// Permanent conflict: no redial storm. One register, then silence.
	time.Sleep(1500 * time.Millisecond)
	relay.mu.Lock()
	registers := relay.registers
	relay.mu.Unlock()
	if registers != 1 {
		t.Fatalf("registers = %d after conflict, want exactly 1 (no retry)", registers)
	}
}

func TestDropReconnectsWithBackoff(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, false)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })
	select {
	case relay.drop <- struct{}{}:
	case <-time.After(2 * time.Second):
		t.Fatal("could not drop the relay socket")
	}
	// Network failure retries with backoff: a second register lands.
	waitFor(t, "re-register", func() bool {
		relay.mu.Lock()
		defer relay.mu.Unlock()
		return relay.registers >= 2
	})
}

func TestLanOnlyNeverDials(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, false)
	fix.agent.mu.Lock()
	fix.agent.lanOnly = true
	fix.agent.mu.Unlock()
	fix.agent.Start()
	time.Sleep(500 * time.Millisecond)
	if fix.agent.Reachable() {
		t.Fatal("lanOnly agent reports reachable")
	}
	relay.mu.Lock()
	registers := relay.registers
	relay.mu.Unlock()
	if registers != 0 {
		t.Fatalf("lanOnly agent registered %d times, want 0", registers)
	}
}

func (r *fakeRelay) waitAccepts(t *testing.T, n int) []rtc.Accept {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		got := len(r.accepts)
		r.mu.Unlock()
		if got >= n {
			r.mu.Lock()
			defer r.mu.Unlock()
			return append([]rtc.Accept(nil), r.accepts...)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("relay got %d accepts, want %d", len(r.accepts), n)
	return nil
}

func (r *fakeRelay) waitRejects(t *testing.T, n int) []rtc.Reject {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		got := len(r.rejects)
		r.mu.Unlock()
		if got >= n {
			r.mu.Lock()
			defer r.mu.Unlock()
			return append([]rtc.Reject(nil), r.rejects...)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("relay got %d rejects, want %d", len(r.rejects), n)
	return nil
}

// phoneOffer builds a pion phone like RtcTransport (both DataChannels,
// non-trickle offer) and returns the SDP plus a completer for the answer.
func phoneOffer(t *testing.T) (string, *webrtc.PeerConnection, *webrtc.DataChannel) {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	ordered := true
	proto := "airdeck-v1"
	control, err := pc.CreateDataChannel("control", &webrtc.DataChannelInit{Ordered: &ordered, Protocol: &proto})
	if err != nil {
		t.Fatal(err)
	}
	unordered := false
	var maxRetransmits uint16
	if _, err := pc.CreateDataChannel("inputs", &webrtc.DataChannelInit{
		Ordered: &unordered, MaxRetransmits: &maxRetransmits, Protocol: &proto,
	}); err != nil {
		t.Fatal(err)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-webrtc.GatheringCompletePromise(pc):
	case <-time.After(10 * time.Second):
		t.Fatal("phone gathering never completed")
	}
	return pc.LocalDescription().SDP, pc, control
}

func acceptOnPhone(t *testing.T, pc *webrtc.PeerConnection, control *webrtc.DataChannel, answerSDP string) protocol.Welcome {
	t.Helper()
	connected := make(chan struct{})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if state == webrtc.PeerConnectionStateConnected {
			select {
			case <-connected:
			default:
				close(connected)
			}
		}
	})
	opened := make(chan struct{})
	control.OnOpen(func() { close(opened) })
	var mu sync.Mutex
	var messages [][]byte
	control.OnMessage(func(message webrtc.DataChannelMessage) {
		if !message.IsString {
			return
		}
		mu.Lock()
		messages = append(messages, append([]byte(nil), message.Data...))
		mu.Unlock()
	})
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answerSDP}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-connected:
	case <-time.After(15 * time.Second):
		t.Fatal("phone never connected")
	}
	select {
	case <-opened:
	case <-time.After(15 * time.Second):
		t.Fatal("phone control never opened")
	}
	hello, _ := json.Marshal(protocol.Hello{
		Type: protocol.MessageHello, SessionCode: "TEST22",
		DisplayName: "Phone", ClientVersion: "test",
	})
	if err := control.SendText(string(hello)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, data := range messages {
			if msgType, _ := protocol.MessageType(data); msgType == protocol.MessageWelcome {
				var welcome protocol.Welcome
				if err := json.Unmarshal(data, &welcome); err != nil {
					mu.Unlock()
					t.Fatal(err)
				}
				mu.Unlock()
				return welcome
			}
		}
		mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("phone never received welcome")
	return protocol.Welcome{}
}

// TestAgentRoutesOpenJoinToAnswer injects a relay join carrying an offer
// and expects the correlated answer back; the answer must be usable for
// a real DTLS + validation-only hello + welcome round-trip.
func TestAgentRoutesOpenJoinToAnswer(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, false)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	offerSDP, pc, control := phoneOffer(t)
	relay.send(t, rtc.Join{
		Type: rtc.MessageJoin, RoomCode: "TEST22", CorrelationID: "corr-agent-1",
		DisplayName: "Phone", Offer: offerSDP,
	})
	answers := relay.waitAnswers(t, 1)
	if answers[0].CorrelationID != "corr-agent-1" || answers[0].SDP == "" {
		t.Fatalf("answer = %+v, want echoed correlation plus SDP", answers[0])
	}
	welcome := acceptOnPhone(t, pc, control, answers[0].SDP)
	if welcome.Slot != 0 || welcome.PlayerID == "" {
		t.Fatalf("welcome = %+v", welcome)
	}
	if n := len(fix.session.Players()); n != 1 {
		t.Fatalf("players = %d, want 1 (no double admit)", n)
	}
}

// TestApprovalPendingAcceptOfferAnswer walks the full approval wire at
// the agent level: relay pending queues a session pending, dashboard
// accept releases accepted to the relay, and the post-accept offer gets
// a correlated answer.
func TestApprovalPendingAcceptOfferAnswer(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-pending-1", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	if pendings := fix.agent.Pendings(); len(pendings) != 1 {
		t.Fatalf("agent pendings = %d, want 1", len(pendings))
	}

	if err := fix.agent.AcceptPending("relay-pending-1"); err != nil {
		t.Fatalf("AcceptPending: %v", err)
	}
	accepts := relay.waitAccepts(t, 1)
	if accepts[0].PendingID != "relay-pending-1" {
		t.Fatalf("accept = %+v", accepts[0])
	}
	if pendings := fix.session.Pendings(); len(pendings) != 0 {
		t.Fatalf("session pendings = %d after accept, want 0", len(pendings))
	}

	offerSDP, pc, control := phoneOffer(t)
	relay.send(t, rtc.Offer{
		Type: rtc.MessageOffer, PendingID: "relay-pending-1",
		CorrelationID: "corr-approved", SDP: offerSDP,
	})
	answers := relay.waitAnswers(t, 1)
	if answers[0].CorrelationID != "corr-approved" || answers[0].SDP == "" {
		t.Fatalf("answer = %+v", answers[0])
	}
	welcome := acceptOnPhone(t, pc, control, answers[0].SDP)
	if welcome.PlayerID == "" {
		t.Fatalf("welcome = %+v", welcome)
	}
	if n := len(fix.session.Players()); n != 1 {
		t.Fatalf("players = %d, want exactly the accepted one", n)
	}
}

func TestAgentRejectPending(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-pending-9", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	if err := fix.agent.RejectPending("relay-pending-9", "party is full"); err != nil {
		t.Fatalf("RejectPending: %v", err)
	}
	rejects := relay.waitRejects(t, 1)
	if rejects[0].PendingID != "relay-pending-9" || rejects[0].Reason != "party is full" {
		t.Fatalf("reject = %+v", rejects[0])
	}
	if pendings := fix.session.Pendings(); len(pendings) != 0 {
		t.Fatalf("session pendings = %d after reject, want 0", len(pendings))
	}
	if pendings := fix.agent.Pendings(); len(pendings) != 0 {
		t.Fatalf("agent pendings = %d after reject, want 0", len(pendings))
	}
}

func TestAgentPeerLeftEvaporates(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-pending-x", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	relay.send(t, rtc.PeerLeft{Type: rtc.MessagePeerLeft, PendingID: "relay-pending-x"})
	waitFor(t, "evaporate", func() bool { return len(fix.session.Pendings()) == 0 })
	if pendings := fix.agent.Pendings(); len(pendings) != 0 {
		t.Fatalf("agent pendings = %d after peer.left, want 0", len(pendings))
	}
}

// TestAgentReclaimSkipsQueue admits a player, disconnects into grace,
// then feeds its reconnect id as an approval pending: the agent must
// accept at once without parking a session pending.
func TestAgentReclaimSkipsQueue(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	// Admit outside approval so the player exists, then drop to grace.
	fix.session.SetApprovalRequired(false)
	open, err := fix.session.Admit(fix.session.Code(), "Phone", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := fix.session.Disconnect(open.Player.ID, open.Player.Generation); err != nil {
		t.Fatal(err)
	}
	fix.session.SetApprovalRequired(true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{
		Type: rtc.MessagePending, PendingID: "relay-reclaim",
		DisplayName: "Phone", ReconnectID: open.Player.ReconnectID,
	})
	accepts := relay.waitAccepts(t, 1)
	if accepts[0].PendingID != "relay-reclaim" {
		t.Fatalf("accept = %+v, want immediate reclaim accept", accepts[0])
	}
	if pendings := fix.session.Pendings(); len(pendings) != 0 {
		t.Fatalf("reclaim queued %d session pendings, want 0", len(pendings))
	}
}

func TestSetApprovalRequiredReregisters(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, false)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })
	fix.agent.SetApprovalRequired(true)
	waitFor(t, "re-register", func() bool {
		relay.mu.Lock()
		defer relay.mu.Unlock()
		return relay.registers >= 2
	})
}

// TestAcceptedPendingPeerLeftFreesSlot: accept parks an admitted player
// with no PC yet; a peer.left before its offer must free the slot instead
// of leaking an Active player with no transport.
func TestAcceptedPendingPeerLeftFreesSlot(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-accepted-gone", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	if err := fix.agent.AcceptPending("relay-accepted-gone"); err != nil {
		t.Fatal(err)
	}
	relay.waitAccepts(t, 1)
	if n := len(fix.session.Players()); n != 1 {
		t.Fatalf("players = %d after accept, want 1", n)
	}
	relay.send(t, rtc.PeerLeft{Type: rtc.MessagePeerLeft, PendingID: "relay-accepted-gone"})
	waitFor(t, "slot freed", func() bool { return len(fix.session.Players()) == 0 })
}

// TestDuplicateOfferIgnoredAfterAnswer: a retransmitted post-accept offer
// must not mint a second PC once its answer already went out.
func TestDuplicateOfferIgnoredAfterAnswer(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-dup", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	if err := fix.agent.AcceptPending("relay-dup"); err != nil {
		t.Fatal(err)
	}
	relay.waitAccepts(t, 1)

	offerSDP, _, _ := phoneOffer(t)
	relay.send(t, rtc.Offer{
		Type: rtc.MessageOffer, PendingID: "relay-dup",
		CorrelationID: "corr-first", SDP: offerSDP,
	})
	relay.waitAnswers(t, 1)
	relay.send(t, rtc.Offer{
		Type: rtc.MessageOffer, PendingID: "relay-dup",
		CorrelationID: "corr-retransmit", SDP: offerSDP,
	})
	time.Sleep(500 * time.Millisecond)
	relay.mu.Lock()
	answers := len(relay.answers)
	relay.mu.Unlock()
	if answers != 1 {
		t.Fatalf("answers = %d after retransmit, want 1 (duplicate ignored)", answers)
	}
	if n := fix.peers.PeerCount(); n != 1 {
		t.Fatalf("peers = %d, want 1", n)
	}
}

// TestAcceptedOfferTimeoutFreesSlot: accept with no post-accept offer must
// not leak the admitted slot once the wait expires.
func TestAcceptedOfferTimeoutFreesSlot(t *testing.T) {
	old := offerWaitTimeout
	offerWaitTimeout = 100 * time.Millisecond
	defer func() { offerWaitTimeout = old }()
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-offer-timeout", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })
	if err := fix.agent.AcceptPending("relay-offer-timeout"); err != nil {
		t.Fatal(err)
	}
	relay.waitAccepts(t, 1)
	waitFor(t, "offer timeout to free the slot", func() bool { return len(fix.session.Players()) == 0 })
}

// TestRegisterConnSurvivesIdlePings is the regression test for the 90s
// registration flap: gorilla consumes pings inside ReadMessage without
// returning, so a register socket with no data frames died on the read
// deadline despite the relay pinging every 30s. With the heartbeat refresh
// armed, pings hold the deadline open; silence after they stop still times
// out, proving a truly dead socket is detected.
func TestRegisterConnSurvivesIdlePings(t *testing.T) {
	old := readTimeout
	readTimeout = 300 * time.Millisecond
	defer func() { readTimeout = old }()

	done := make(chan struct{})
	defer close(done)
	stopPings := make(chan struct{})
	m := http.NewServeMux()
	m.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		pinging := true
		for pinging {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = conn.SetWriteDeadline(time.Now().Add(time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			case <-stopPings:
				pinging = false
			}
		}
		// Hold the socket open in silence so the read deadline can fire.
		<-done
	})
	server := httptest.NewServer(m)
	defer server.Close()

	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/register", nil)
	if err != nil {
		t.Fatalf("dial register: %v", err)
	}
	defer conn.Close()
	armRegisterConn(conn)

	// Ping for a full second, then go silent: without the refresh this
	// dies at ~300ms.
	pingStop := time.AfterFunc(time.Second, func() { close(stopPings) })
	defer pingStop.Stop()
	_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
	start := time.Now()
	_, _, err = conn.ReadMessage()
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("idle ReadMessage returned a frame, want timeout")
	}
	if ne, ok := err.(net.Error); !ok || !ne.Timeout() {
		t.Fatalf("ReadMessage err = %v, want timeout", err)
	}
	// Pings held the deadline through the first second; the timeout fired
	// only after they stopped (1s pings + ~300ms deadline, wide margins).
	if elapsed < 900*time.Millisecond {
		t.Fatalf("ReadMessage timed out after %v, want it to survive the ping window", elapsed)
	}
}
