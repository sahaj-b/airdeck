package setup

import (
	"strings"
	"testing"
)

func TestRuleGrantsUInputToInputGroup(t *testing.T) {
	if !strings.Contains(Rule, `KERNEL=="uinput"`) || !strings.Contains(Rule, `GROUP="input"`) || !strings.Contains(Rule, `MODE="0660"`) {
		t.Fatalf("unexpected udev rule: %s", Rule)
	}
}
