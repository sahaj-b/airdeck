package protocol

import "testing"

func TestDecodeHelloValidatesAdmissionFields(t *testing.T) {
	valid := []byte(`{"type":"hello","sessionCode":"ABCD2E","displayName":"Player","clientVersion":"test","capabilities":{}}`)
	if _, err := DecodeHello(valid); err != nil {
		t.Fatal(err)
	}
	// Dashes, spaces, and lowercase fold before validation; the wire field
	// name stays `sessionCode`.
	folded := []byte(`{"type":"hello","sessionCode":"ab-cd 2e","displayName":"Player","clientVersion":"test","capabilities":{}}`)
	if _, err := DecodeHello(folded); err != nil {
		t.Fatalf("folded room code rejected: %v", err)
	}
	cases := []string{
		`{"type":"hello","sessionCode":"42","clientVersion":"test"}`,
		`{"type":"hello","sessionCode":"12x4","clientVersion":"test"}`,
		`{"type":"hello","sessionCode":"0042","clientVersion":"test"}`,
		`{"type":"hello","sessionCode":"ABCD2E","clientVersion":"test","unexpected":true}`,
	}
	for _, data := range cases {
		if _, err := DecodeHello([]byte(data)); err == nil {
			t.Fatalf("accepted invalid hello %s", data)
		}
	}
}

func TestDecodeHelloAllowsEmptySessionCode(t *testing.T) {
	data := []byte(`{"type":"hello","sessionCode":"","displayName":"Player","clientVersion":"test","capabilities":{}}`)
	hello, err := DecodeHello(data)
	if err != nil {
		t.Fatal(err)
	}
	if hello.SessionCode != "" {
		t.Fatalf("expected empty session code, got %q", hello.SessionCode)
	}
}
