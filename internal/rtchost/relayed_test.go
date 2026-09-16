package rtchost

import (
	"testing"

	"github.com/sahaj-b/airdeck/internal/device"
	"github.com/sahaj-b/airdeck/internal/input"
	"github.com/sahaj-b/airdeck/internal/layout"
	"github.com/sahaj-b/airdeck/internal/session"
)

// TestIsRelayedDefaultsFalse pins the dashboard badge default: unknown
// players and freshly admitted LAN players (no peer) report unknown,
// never direct. The badge must not lie during ICE setup.
func TestIsRelayedDefaultsFalse(t *testing.T) {
	library, err := layout.LoadDefault("", "xbox-default")
	if err != nil {
		t.Fatal(err)
	}
	sess, err := session.New(library, device.NewManager(&fakeFactory{}), 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sess.Close() })
	handler := input.NewHandler(sess)
	manager := New(sess, handler, library, 60)

	if manager.Has("nope") {
		t.Fatal("Has(nope) = true, want false")
	}
	if relayed, known := manager.IsRelayed("nope"); relayed || known {
		t.Fatalf("IsRelayed(nope) = (%v, %v), want (false, false)", relayed, known)
	}

	admission, err := sess.Admit(sess.Code(), "Phone", "", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if manager.Has(admission.Player.ID) {
		t.Fatal("LAN player Has = true, want false (no peer)")
	}
	if relayed, known := manager.IsRelayed(admission.Player.ID); relayed || known {
		t.Fatalf("LAN player IsRelayed = (%v, %v), want (false, false)", relayed, known)
	}
}
