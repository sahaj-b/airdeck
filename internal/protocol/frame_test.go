package protocol

import (
	"bytes"
	"testing"
)

func TestFrameGoldenVector(t *testing.T) {
	frame := Frame{Seq: 0x01020304, Buttons: BitSouth | BitDPadRight | BitGuide, LX: -2, LY: 3, RX: -32768, RY: 32767, LT: 17, RT: 255}
	want := []byte{1, 0, 4, 3, 2, 1, 0x81, 0x40, 0, 0, 0xfe, 0xff, 3, 0, 0, 0x80, 0xff, 0x7f, 17, 255}
	got := frame.Encode()
	if !bytes.Equal(got, want) {
		t.Fatalf("encoded frame = %v, want %v", got, want)
	}
	decoded, err := DecodeFrame(got)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != frame {
		t.Fatalf("decoded frame = %+v, want %+v", decoded, frame)
	}
}

func TestDecodeFrameRejectsMalformedInput(t *testing.T) {
	base := make([]byte, FrameSize)
	base[0] = Version
	cases := []struct {
		name   string
		mutate func([]byte)
	}{
		{"wrong length", func(data []byte) { _ = data }},
		{"version", func(data []byte) { data[0] = 2 }},
		{"flags", func(data []byte) { data[1] = 1 }},
		{"unknown buttons", func(data []byte) { data[6] = 0x00; data[9] = 0x80 }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			data := append([]byte(nil), base...)
			if test.name == "wrong length" {
				data = data[:FrameSize-1]
			} else {
				test.mutate(data)
			}
			if _, err := DecodeFrame(data); err == nil {
				t.Fatal("DecodeFrame accepted malformed input")
			}
		})
	}
}

func TestIsNewerSequenceWraps(t *testing.T) {
	if !IsNewerSequence(1, ^uint32(0)) {
		t.Fatal("expected wrapped sequence to be newer")
	}
	if IsNewerSequence(10, 10) {
		t.Fatal("duplicate sequence is newer")
	}
	if IsNewerSequence(1, 2) {
		t.Fatal("older sequence is newer")
	}
}
