package protocol

import (
	"encoding/binary"
	"fmt"
)

type Frame struct {
	Seq     uint32
	Buttons uint32
	LX      int16
	LY      int16
	RX      int16
	RY      int16
	LT      uint8
	RT      uint8
}

func DecodeFrame(data []byte) (Frame, error) {
	if len(data) != FrameSize {
		return Frame{}, fmt.Errorf("input frame must be exactly %d bytes, got %d", FrameSize, len(data))
	}
	if data[0] != Version {
		return Frame{}, fmt.Errorf("unsupported input frame version %d", data[0])
	}
	if data[1] != FrameFlags {
		return Frame{}, fmt.Errorf("unsupported input frame flags %#x", data[1])
	}
	buttons := binary.LittleEndian.Uint32(data[6:10])
	if buttons&^KnownButtonBits != 0 {
		return Frame{}, fmt.Errorf("input frame contains unknown digital bits %#x", buttons&^KnownButtonBits)
	}
	return Frame{
		Seq:     binary.LittleEndian.Uint32(data[2:6]),
		Buttons: buttons,
		LX:      int16(binary.LittleEndian.Uint16(data[10:12])),
		LY:      int16(binary.LittleEndian.Uint16(data[12:14])),
		RX:      int16(binary.LittleEndian.Uint16(data[14:16])),
		RY:      int16(binary.LittleEndian.Uint16(data[16:18])),
		LT:      data[18],
		RT:      data[19],
	}, nil
}

func (f Frame) Encode() []byte {
	data := make([]byte, FrameSize)
	data[0] = Version
	data[1] = FrameFlags
	binary.LittleEndian.PutUint32(data[2:6], f.Seq)
	binary.LittleEndian.PutUint32(data[6:10], f.Buttons&KnownButtonBits)
	binary.LittleEndian.PutUint16(data[10:12], uint16(f.LX))
	binary.LittleEndian.PutUint16(data[12:14], uint16(f.LY))
	binary.LittleEndian.PutUint16(data[14:16], uint16(f.RX))
	binary.LittleEndian.PutUint16(data[16:18], uint16(f.RY))
	data[18] = f.LT
	data[19] = f.RT
	return data
}

func IsNewerSequence(next, previous uint32) bool {
	delta := next - previous
	return delta != 0 && delta < 1<<31
}
