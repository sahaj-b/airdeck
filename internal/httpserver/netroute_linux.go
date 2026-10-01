//go:build linux

package httpserver

import (
	"os"
	"strings"
)

func defaultRouteInterface() (string, error) {
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] == "Iface" {
			continue
		}
		if fields[1] == "00000000" {
			return fields[0], nil
		}
	}
	return "", nil
}
