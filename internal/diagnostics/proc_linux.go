//go:build linux

package diagnostics

import (
	"bytes"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func Sample(players int) ResourceSample {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	entries, _ := os.ReadDir("/proc/self/fd")
	userCPU, systemCPU := readCPUTime()
	return ResourceSample{At: time.Now(), Players: players, Goroutines: runtime.NumGoroutine(), Memory: memory.Alloc, FileDescriptors: len(entries), UserCPUTime: userCPU, SystemCPUTime: systemCPU}
}

// readCPUTime reads utime and stime (clock ticks) from /proc/self/stat.
// The comm field may contain spaces and closing parens, so everything up to
// the final ')' is skipped before field splitting.
func readCPUTime() (time.Duration, time.Duration) {
	data, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		return 0, 0
	}
	end := bytes.LastIndexByte(data, ')')
	if end < 0 {
		return 0, 0
	}
	fields := strings.Fields(string(data[end+1:]))
	if len(fields) < 3 {
		return 0, 0
	}
	// /proc CPU times are counted in USER_HZ ticks. USER_HZ is 100 on the
	// x86_64 baseline; the absolute seconds are approximate, but relative
	// comparisons between samples are exact.
	const userHz = 100
	utime, _ := strconv.ParseUint(fields[1], 10, 64)
	stime, _ := strconv.ParseUint(fields[2], 10, 64)
	return time.Duration(utime) * time.Second / userHz, time.Duration(stime) * time.Second / userHz
}
