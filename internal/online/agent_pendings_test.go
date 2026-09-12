package online

import (
	"testing"
	"time"

	"github.com/sahaj-b/airdeck/internal/rtc"
)

// TestAgentPendingsListsRelayQueue proves the dashboard view: queued relay
// approvals appear under relay ids with names from the session, accepted
// admissions leave the queue, and OwnsSessionPending hides the backing row.
func TestAgentPendingsListsRelayQueue(t *testing.T) {
	relay, server := newFakeRelay(t, false)
	fix := newAgentFixture(t, server, true)
	fix.agent.Start()
	waitFor(t, "registration", func() bool { return fix.agent.Reachable() })

	relay.send(t, rtc.Pending{Type: rtc.MessagePending, PendingID: "relay-q1", DisplayName: "Phone"})
	waitFor(t, "session pending", func() bool { return len(fix.session.Pendings()) == 1 })

	pendings := fix.agent.Pendings()
	if len(pendings) != 1 || pendings[0].ID != "relay-q1" || pendings[0].DisplayName != "Phone" {
		t.Fatalf("agent pendings = %+v, want [relay-q1 Phone]", pendings)
	}
	if pendings[0].WaitingSince.IsZero() || time.Since(pendings[0].WaitingSince) > time.Minute {
		t.Fatalf("waitingSince = %v, want recent", pendings[0].WaitingSince)
	}
	sessionID := fix.session.Pendings()[0].ID
	if !fix.agent.OwnsSessionPending(sessionID) {
		t.Fatalf("OwnsSessionPending(%s) = false, want true", sessionID)
	}
	if fix.agent.OwnsSessionPending("nope") {
		t.Fatal("OwnsSessionPending(nope) = true, want false")
	}

	if err := fix.agent.AcceptPending("relay-q1"); err != nil {
		t.Fatal(err)
	}
	relay.waitAccepts(t, 1)
	if pendings := fix.agent.Pendings(); len(pendings) != 0 {
		t.Fatalf("pendings after accept = %+v, want empty", pendings)
	}
	if fix.agent.OwnsSessionPending(sessionID) {
		t.Fatal("OwnsSessionPending still true after accept")
	}
}
