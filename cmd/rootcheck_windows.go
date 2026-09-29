//go:build windows

package main

// Serve on Windows is allowed at any integrity level; ViGEm works elevated
// or not, so refusing elevated serve buys nothing. Setup is the only op
// that needs elevation.
func mustNotBeRoot() error { return nil }

func warnIfRoot() {}
