//go:build linux

package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/sahaj-b/airdeck/internal/uinput"
)

const (
	evSyn, evKey, evAbs, evFF = 0x00, 0x01, 0x03, 0x15
	evioCsff                  = 0x40304580 // _IOW('E', 0x80, struct ff_effect)
)

type ffEffect struct {
	Type      uint16
	ID        int16
	Direction uint16
	Trigger   [4]byte
	Replay    [4]byte
	_         [2]byte
	Rumble    struct{ Strong, Weak uint16 }
	_         [28]byte
}

func main() {
	var rumbles []string
	ctl, err := uinput.NewController(uinput.Config{
		Rumble: func(s, w uint16) { rumbles = append(rumbles, fmt.Sprintf("strong=%d weak=%d", s, w)) },
	})
	if err != nil {
		panic(err)
	}
	defer ctl.Destroy()

	syspath, _ := ctl.Syspath()
	eventNode := findEventNode(syspath)
	fmt.Println("syspath:", syspath, "->", eventNode)
	if eventNode == "" {
		return
	}

	dev, err := os.OpenFile(eventNode, os.O_RDWR, 0)
	if err != nil {
		panic(err)
	}
	type ev struct {
		typ, code uint16
		val       int32
	}
	var got []ev
	done := make(chan struct{})
	go func() {
		buf := make([]byte, 24*64)
		for {
			n, err := dev.Read(buf)
			if err != nil {
				close(done)
				return
			}
			for off := 0; off+24 <= n; off += 24 {
				got = append(got, ev{
					typ:  binary.LittleEndian.Uint16(buf[off+16:]),
					code: binary.LittleEndian.Uint16(buf[off+18:]),
					val:  int32(binary.LittleEndian.Uint32(buf[off+20:])),
				})
			}
		}
	}()

	time.Sleep(100 * time.Millisecond)
	err = ctl.Apply(uinput.State{Buttons: uinput.BtnSouth | uinput.BtnDPadUp | uinput.BtnRB, LX: 1000, RY: -2000, RT: 200})
	check(err)
	time.Sleep(50 * time.Millisecond)

	eff := ffEffect{Type: 0x50 /*FF_RUMBLE*/, ID: -1}
	eff.Rumble.Strong, eff.Rumble.Weak = 40000, 12000
	ret := ioctl(dev.Fd(), evioCsff, uintptr(unsafe.Pointer(&eff)))
	fmt.Printf("EVIOCSFF ret=%d effect_id=%d\n", ret, eff.ID)
	play := make([]byte, 24)
	binary.LittleEndian.PutUint16(play[16:], evFF)
	binary.LittleEndian.PutUint16(play[18:], uint16(eff.ID))
	binary.LittleEndian.PutUint32(play[20:], 1)
	_, err = dev.Write(play)
	fmt.Println("play write err:", err)
	time.Sleep(300 * time.Millisecond)
	binary.LittleEndian.PutUint32(play[20:], 0)
	dev.Write(play)
	time.Sleep(100 * time.Millisecond)

	check(ctl.Neutralize())
	time.Sleep(50 * time.Millisecond)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() {
		time.Sleep(time.Second)
		sig <- os.Interrupt
	}()
	<-sig

	names := map[uint16]string{
		evSyn: "SYN", evKey: "KEY", evAbs: "ABS", evFF: "FF",
		0x130: "BTN_SOUTH", 0x131: "BTN_EAST", 0x137: "BTN_TR",
	}
	for _, e := range got {
		name := names[e.code]
		if name == "" || e.typ != evSyn {
			name = fmt.Sprintf("%#x", e.code)
		} else {
			name = names[e.code]
		}
		fmt.Printf("%s code=%s val=%d\n", names[e.typ], name, e.val)
	}
	fmt.Println("rumble callbacks:", rumbles)
}

func findEventNode(syspath string) string {
	entries, err := os.ReadDir(syspath)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "event") {
			return filepath.Join("/dev/input", e.Name())
		}
	}
	return ""
}

func ioctl(fd, cmd, arg uintptr) int {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, cmd, arg)
	if errno != 0 {
		return -int(errno)
	}
	return 0
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
