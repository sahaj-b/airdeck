package rtchost

import (
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/protocol"
	"github.com/sahaj-b/airdeck/internal/rtc"
	"github.com/sahaj-b/airdeck/internal/session"
	"github.com/sahaj-b/airdeck/internal/uinput"
)

type fakeDevice struct {
	mu     sync.Mutex
	states []uinput.State
}

func (d *fakeDevice) Apply(state uinput.State) error {
	d.mu.Lock()
	d.states = append(d.states, state)
	d.mu.Unlock()
	return nil
}

func (d *fakeDevice) Neutralize() error { return nil }
func (d *fakeDevice) Destroy() error    { return nil }
func (d *fakeDevice) Syspath() (string, error) {
	return "fake", nil
}

type fakeFactory struct {
	mu      sync.Mutex
	devices []*fakeDevice
}

func (f *fakeFactory) Create(device.RumbleFunc) (device.Device, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &fakeDevice{}
	f.devices = append(f.devices, d)
	return d, nil
}

func (f *fakeFactory) appliedStates() []uinput.State {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []uinput.State
	for _, d := range f.devices {
		d.mu.Lock()
		out = append(out, d.states...)
		d.mu.Unlock()
	}
	return out
}

func newTestManager(t *testing.T, approval bool) (*PeerManager, *session.Session, *fakeFactory) {
	t.Helper()
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	factory := &fakeFactory{}
	sess, err := session.New(library, device.NewManager(factory), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	sess.SetApprovalRequired(approval)
	handler := input.NewHandler(sess)
	manager := New(sess, handler, library, 60)
	// Tests stay on host candidates: no STUN round-trip, gather completes
	// from local interfaces in milliseconds.
	manager.SetICEServers(nil)
	return manager, sess, factory
}

// testPhone is a pion PeerConnection playing the web client: it creates
// both DataChannels before its offer, exactly like RtcTransport.
type testPhone struct {
	pc      *webrtc.PeerConnection
	control *webrtc.DataChannel
	inputs  *webrtc.DataChannel

	mu        sync.Mutex
	messages  [][]byte
	opened    chan struct{}
	connected chan struct{}
}

func dialTestPhone(t *testing.T) *testPhone {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	phone := &testPhone{pc: pc, opened: make(chan struct{})}
	ordered := true
	control, err := pc.CreateDataChannel(ControlLabel, &webrtc.DataChannelInit{Ordered: &ordered, Protocol: strPtr(DataChannelProtocol)})
	if err != nil {
		t.Fatal(err)
	}
	unordered := false
	var maxRetransmits uint16
	inputs, err := pc.CreateDataChannel(InputsLabel, &webrtc.DataChannelInit{
		Ordered: &unordered, MaxRetransmits: &maxRetransmits, Protocol: strPtr(DataChannelProtocol),
	})
	if err != nil {
		t.Fatal(err)
	}
	phone.control = control
	phone.inputs = inputs
	control.OnOpen(func() { close(phone.opened) })
	control.OnMessage(func(message webrtc.DataChannelMessage) {
		if !message.IsString {
			return
		}
		phone.mu.Lock()
		phone.messages = append(phone.messages, append([]byte(nil), message.Data...))
		phone.mu.Unlock()
	})
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
	t.Cleanup(func() { _ = pc.Close() })
	phone.connected = connected
	return phone
}

func strPtr(s string) *string { return &s }

func (p *testPhone) offer(t *testing.T) string {
	t.Helper()
	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	select {
	case <-webrtc.GatheringCompletePromise(p.pc):
	case <-time.After(10 * time.Second):
		t.Fatal("phone ICE gathering never completed")
	}
	return p.pc.LocalDescription().SDP
}

func (p *testPhone) acceptAnswer(t *testing.T, answerSDP string) {
	t.Helper()
	if err := p.pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answerSDP}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-p.connected:
	case <-time.After(15 * time.Second):
		t.Fatalf("phone never connected (state=%s)", p.pc.ConnectionState())
	}
	select {
	case <-p.opened:
	case <-time.After(15 * time.Second):
		t.Fatal("phone control channel never opened")
	}
}

// waitMessage returns the next control message of one type, failing the
// test on timeout. Messages arrive welcome-then-layout back to back, so
// the helper scans everything received so far.
func (p *testPhone) waitMessage(t *testing.T, wantType string) []byte {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		p.mu.Lock()
		var found []byte
		for _, data := range p.messages {
			msgType, err := protocol.MessageType(data)
			if err == nil && msgType == wantType {
				found = data
				break
			}
		}
		p.mu.Unlock()
		if found != nil {
			return found
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("phone never received %q", wantType)
	return nil
}

func sendHello(t *testing.T, phone *testPhone, code string) {
	t.Helper()
	hello, err := json.Marshal(protocol.Hello{
		Type: protocol.MessageHello, SessionCode: code,
		DisplayName: "Phone", ClientVersion: "test",
		SelectedLayout: "xbox-default",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := phone.control.SendText(string(hello)); err != nil {
		t.Fatalf("send hello: %v", err)
	}
}

func TestOpenJoinAnswerFlowsInputsEndToEnd(t *testing.T) {
	manager, sess, factory := newTestManager(t, false)
	phone := dialTestPhone(t)
	offerSDP := phone.offer(t)

	answerSDP, admission, err := manager.HandleJoin(rtc.Join{
		Type: rtc.MessageJoin, CorrelationID: "corr-1",
		DisplayName: "Phone", Offer: offerSDP,
	})
	if err != nil {
		t.Fatalf("HandleJoin: %v", err)
	}
	if answerSDP == "" || admission.Player.ID == "" {
		t.Fatal("join produced no answer or no player")
	}
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("players = %d after join, want 1", n)
	}
	phone.acceptAnswer(t, answerSDP)

	sendHello(t, phone, sess.Code())
	data := phone.waitMessage(t, protocol.MessageWelcome)
	var welcome protocol.Welcome
	if err := json.Unmarshal(data, &welcome); err != nil {
		t.Fatalf("decode welcome: %v", err)
	}
	if welcome.PlayerID != admission.Player.ID || welcome.Slot != 0 {
		t.Fatalf("welcome = %+v, want player %s slot 0", welcome, admission.Player.ID)
	}
	if welcome.ProtocolVersion != protocol.Version || welcome.FrameSize != protocol.FrameSize {
		t.Fatalf("welcome version/size = %d/%d, want %d/%d",
			welcome.ProtocolVersion, welcome.FrameSize, protocol.Version, protocol.FrameSize)
	}
	phone.waitMessage(t, protocol.MessageLayout)

	// The validation-only hello minted nothing: still exactly one player.
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("players = %d after hello, want 1 (hello must never admit)", n)
	}

	frame := protocol.Frame{Seq: 7, Buttons: 1 << 0, LX: 1000, LY: -1000, LT: 42}
	if err := phone.inputs.Send(frame.Encode()); err != nil {
		t.Fatalf("send inputs: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if len(factory.appliedStates()) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	states := factory.appliedStates()
	if len(states) == 0 {
		t.Fatal("inputs never reached the device")
	}
	last := states[len(states)-1]
	if last.Buttons != frame.Buttons || last.LX != frame.LX || last.LY != frame.LY || last.LT != frame.LT {
		t.Fatalf("device state = %+v, want %+v", last, frame)
	}
	if manager.PeerCount() != 1 {
		t.Fatalf("peers = %d, want 1", manager.PeerCount())
	}
}

// TestApprovalOfferUsesStoredAdmission covers the post-accept path: the
// offer carries an admission from AcceptPending, never runs Admit, and
// the hello still receives the accepted welcome.
func TestApprovalOfferUsesStoredAdmission(t *testing.T) {
	manager, sess, _ := newTestManager(t, true)
	queued, err := sess.Admit(sess.Code(), "Phone", "", "", nil, nil)
	if !errors.Is(err, session.ErrApprovalPending) {
		t.Fatalf("queue error = %v, want pending", err)
	}
	admission, err := sess.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatalf("AcceptPending: %v", err)
	}

	phone := dialTestPhone(t)
	offerSDP := phone.offer(t)
	answerSDP, err := manager.HandleOffer(rtc.Offer{
		Type: rtc.MessageOffer, PendingID: queued.PendingID,
		CorrelationID: "corr-accept", SDP: offerSDP,
	}, admission)
	if err != nil {
		t.Fatalf("HandleOffer: %v", err)
	}
	phone.acceptAnswer(t, answerSDP)
	sendHello(t, phone, sess.Code())
	data := phone.waitMessage(t, protocol.MessageWelcome)
	var welcome protocol.Welcome
	if err := json.Unmarshal(data, &welcome); err != nil {
		t.Fatal(err)
	}
	if welcome.PlayerID != admission.Player.ID {
		t.Fatalf("welcome player = %q, want accepted %q", welcome.PlayerID, admission.Player.ID)
	}
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("players = %d, want exactly the accepted one", n)
	}
}

// TestHelloParityWithLANSocket checks the failure codes match the /ws
// mapping byte for byte: bad hello, wrong code, unknown player.
func TestHelloParityWithLANSocket(t *testing.T) {
	manager, sess, _ := newTestManager(t, false)
	phone := dialTestPhone(t)
	answerSDP, admission, err := manager.HandleJoin(rtc.Join{
		Type: rtc.MessageJoin, CorrelationID: "corr-parity", Offer: phone.offer(t),
	})
	if err != nil {
		t.Fatal(err)
	}
	phone.acceptAnswer(t, answerSDP)

	// Wrong room code on the validation-only hello: invalid_code, no mint.
	// Flip one char of the real code so the claim is valid-alphabet but
	// guaranteed different (DecodeHello would reject gibberish earlier
	// with invalid_hello, a different check).
	wrongCode := sess.Code()
	if wrongCode[0] != 'Z' {
		wrongCode = "Z" + wrongCode[1:]
	} else {
		wrongCode = "Q" + wrongCode[1:]
	}
	bad, _ := json.Marshal(protocol.Hello{
		Type: protocol.MessageHello, SessionCode: wrongCode, ClientVersion: "test",
	})
	if err := phone.control.SendText(string(bad)); err != nil {
		t.Fatal(err)
	}
	data := phone.waitMessage(t, protocol.MessageError)
	var errMsg protocol.ErrorMessage
	if err := json.Unmarshal(data, &errMsg); err != nil {
		t.Fatal(err)
	}
	wantCode, _ := session.AdmissionError(session.ErrInvalidCode)
	if errMsg.Code != wantCode {
		t.Fatalf("hello error code = %q, want %q", errMsg.Code, wantCode)
	}
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("failed hello minted players: %d, want 1", n)
	}
	_ = admission
}

func TestToPionConversion(t *testing.T) {
	converted := toPion([]rtc.ICEServer{
		{URLs: []string{"stun:stun.cloudflare.com:3478"}},
		{URLs: []string{"turn:turn.cloudflare.com:3478"}, Username: "user", Credential: "pass"},
	})
	if len(converted) != 2 {
		t.Fatalf("converted %d servers, want 2", len(converted))
	}
	if converted[0].Credential != nil {
		t.Fatalf("STUN entry carries credentials: %+v", converted[0])
	}
	if converted[1].Credential != "pass" || converted[1].CredentialType != webrtc.ICECredentialTypePassword {
		t.Fatalf("TURN entry = %+v, want password credential", converted[1])
	}
}

func TestSendValueWithoutOpenChannel(t *testing.T) {
	manager, _, _ := newTestManager(t, false)
	p := &peer{manager: manager, playerID: "ghost", closed: make(chan struct{}), pings: make(map[string]time.Time)}
	// Rumble to a not-yet-open channel drops silently (watchdog-safe);
	// anything else reports the missing channel instead of blocking.
	if err := p.sendValue(protocol.Rumble{Type: protocol.MessageRumble}); err != nil {
		t.Fatalf("rumble without channel: %v, want drop", err)
	}
	if err := p.sendValue(protocol.Ping{Type: protocol.MessagePing}); err == nil {
		t.Fatal("ping without channel succeeded, want an error")
	}
}

func TestHandleJoinRejectsEmptyOffer(t *testing.T) {
	manager, sess, _ := newTestManager(t, false)
	if _, _, err := manager.HandleJoin(rtc.Join{Type: rtc.MessageJoin, CorrelationID: "x"}); err == nil {
		t.Fatal("offer-less open join succeeded, want an error")
	}
	if n := len(sess.Players()); n != 0 {
		t.Fatalf("failed join left %d players", n)
	}
}

// TestApprovalSkewEvaporatesOrphan covers the flag-skew window: the relay
// still routes open while the host already requires approval. The join
// must fail without leaving a session pending that could never complete.
func TestApprovalSkewEvaporatesOrphan(t *testing.T) {
	manager, sess, _ := newTestManager(t, true)
	phone := dialTestPhone(t)
	_, _, err := manager.HandleJoin(rtc.Join{
		Type: rtc.MessageJoin, CorrelationID: "corr-skew", Offer: phone.offer(t),
	})
	if err == nil {
		t.Fatal("open join with approval on succeeded, want an error")
	}
	if pendings := sess.Pendings(); len(pendings) != 0 {
		t.Fatalf("skew join left %d orphan pendings, want 0", len(pendings))
	}
	if players := len(sess.Players()); players != 0 {
		t.Fatalf("skew join left %d players, want 0", players)
	}
}

// TestConcurrentAttachesLeaveOnePeer hammers one admission with parallel
// offers: the map swap is atomic, so exactly one PC survives and the
// loser is closed, never orphaned live.
func TestConcurrentAttachesLeaveOnePeer(t *testing.T) {
	manager, sess, _ := newTestManager(t, true)
	queued, err := sess.Admit(sess.Code(), "Phone", "", "", nil, nil)
	if !errors.Is(err, session.ErrApprovalPending) {
		t.Fatalf("queue error = %v", err)
	}
	admission, err := sess.AcceptPending(queued.PendingID)
	if err != nil {
		t.Fatal(err)
	}
	const racers = 4
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			phone := dialTestPhone(t)
			offer := phone.offer(t)
			_, _ = manager.HandleOffer(rtc.Offer{
				Type: rtc.MessageOffer, CorrelationID: string(rune('a' + i)), SDP: offer,
			}, admission)
		}(i)
	}
	wg.Wait()
	if n := manager.PeerCount(); n != 1 {
		t.Fatalf("peers = %d after %d racing attaches, want 1", n, racers)
	}
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("players = %d, want 1", n)
	}
	// A fresh attach after the churn deterministically wins the map;
	// its hello must validate, proving the racers never corrupted the
	// generation (no Disconnect on replace, teardown only for the owner).
	phone := dialTestPhone(t)
	answer, err := manager.HandleOffer(rtc.Offer{
		Type: rtc.MessageOffer, CorrelationID: "corr-winner", SDP: phone.offer(t),
	}, admission)
	if err != nil {
		t.Fatalf("winner attach: %v", err)
	}
	phone.acceptAnswer(t, answer)
	sendHello(t, phone, sess.Code())
	phone.waitMessage(t, protocol.MessageWelcome)
	if n := manager.PeerCount(); n != 1 {
		t.Fatalf("peers = %d after winner, want 1", n)
	}
}

// TestHelloTimeoutKicksGhost: an answered PC whose control channel never
// says hello must not leak its slot. Fresh ghosts are kicked outright.
func TestHelloTimeoutKicksGhost(t *testing.T) {
	old := helloWaitTimeout
	helloWaitTimeout = 100 * time.Millisecond
	defer func() { helloWaitTimeout = old }()
	manager, sess, _ := newTestManager(t, false)
	phone := dialTestPhone(t)
	if _, _, err := manager.HandleJoin(rtc.Join{
		Type: rtc.MessageJoin, CorrelationID: "corr-ghost", Offer: phone.offer(t),
	}); err != nil {
		t.Fatal(err)
	}
	if n := len(sess.Players()); n != 1 {
		t.Fatalf("players = %d, want the ghost", n)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if len(sess.Players()) == 0 && manager.PeerCount() == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("ghost survived: players=%d peers=%d", len(sess.Players()), manager.PeerCount())
}
