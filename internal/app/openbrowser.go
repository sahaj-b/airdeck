package app

import "log"

// maybeOpenBrowser opens the dashboard URL when the serve --open flag is set.
// Failures only log; a browser that refuses to launch must never kill serve.
func maybeOpenBrowser(url string, enabled bool) {
	if !enabled {
		return
	}
	if err := openURL(url); err != nil {
		log.Printf("open browser %s: %v", url, err)
	}
}
