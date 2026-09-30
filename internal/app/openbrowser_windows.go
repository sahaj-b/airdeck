//go:build windows

package app

import "golang.org/x/sys/windows"

// openURL launches the default browser via ShellExecute, the same mechanism
// Explorer uses for double-clicked links. No new dependency, no cmd wrapper.
func openURL(url string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	target, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, target, nil, nil, windows.SW_SHOWNORMAL)
}
