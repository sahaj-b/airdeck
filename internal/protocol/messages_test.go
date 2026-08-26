package protocol

import "testing"

func TestDecodeHelloValidatesAdmissionFields(t *testing.T) {
	valid := []byte(`{"type":"hello","sessionCode":"0042","displayName":"Player","clientVersion":"test","capabilities":{"haptics":true}}`)
	if _, err := DecodeHello(valid); err != nil {
		t.Fatal(err)
	}
	cases := []string{
		`{"type":"hello","sessionCode":"42","clientVersion":"test"}`,
		`{"type":"hello","sessionCode":"12x4","clientVersion":"test"}`,
		`{"type":"hello","sessionCode":"1234","clientVersion":"test","unexpected":true}`,
	}
	for _, data := range cases {
		if _, err := DecodeHello([]byte(data)); err == nil {
			t.Fatalf("accepted invalid hello %s", data)
		}
	}
}
