//go:build linux

package diagnostics

import (
	"os"
	"runtime"
	"time"
)

func Sample(players int) ResourceSample {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	entries, _ := os.ReadDir("/proc/self/fd")
	return ResourceSample{At: time.Now(), Players: players, Goroutines: runtime.NumGoroutine(), Memory: memory.Alloc, FileDescriptors: len(entries)}
}
