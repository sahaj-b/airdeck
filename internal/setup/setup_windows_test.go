//go:build windows

package setup

import (
	"strings"
	"testing"
)

func TestWindowsSetupArgsUseWindowsQuoting(t *testing.T) {
	cases := []struct {
		arg  string
		want string
	}{
		{`C:\Program Files\airdeck\airdeck.exe`, `"C:\Program Files\airdeck\airdeck.exe"`},
		{`a"b`, `"a\"b"`},
		{`C:\Program Files\`, `"C:\Program Files\\"`},
	}
	for _, tc := range cases {
		if got := joinArgs([]string{tc.arg}); got != tc.want {
			t.Errorf("joinArgs(%q) = %q, want %q", tc.arg, got, tc.want)
		}
	}
}

func TestWindowsSetupIdempotentCommandSequence(t *testing.T) {
	exe := `C:\Program Files\airdeck\airdeck.exe`
	del := deleteRuleArgs()
	if len(del) == 0 || del[0] != "advfirewall" || !strings.Contains(strings.Join(del, " "), "delete rule") {
		t.Fatalf("delete args = %q, want netsh delete rule", del)
	}
	add := addRuleArgs(exe, 6969)
	joined := strings.Join(add, " ")
	if !strings.Contains(joined, "add rule") {
		t.Fatalf("add args = %q, want netsh add rule", add)
	}
	if !strings.Contains(joined, `"C:\Program Files\airdeck\airdeck.exe"`) {
		t.Fatalf("add args = %q, want quoted exe path", add)
	}
	if !strings.Contains(joined, "localport=6969") {
		t.Fatalf("add args = %q, want localport", add)
	}
}
