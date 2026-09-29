package setup

import "os"

// colorsAreEnabled reports whether stdout is a terminal and NO_COLOR is unset.
func colorsAreEnabled() bool {
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	info, err := os.Stdout.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

const (
	colorGreen  = "32"
	colorYellow = "33"
	colorDim    = "2"
)

func paint(code, text string) string {
	if !colorsAreEnabled() {
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}

func green(text string) string  { return paint(colorGreen, text) }
func yellow(text string) string { return paint(colorYellow, text) }
func dim(text string) string    { return paint(colorDim, text) }
