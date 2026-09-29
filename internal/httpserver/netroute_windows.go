//go:build windows

package httpserver

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// defaultRouteInterface returns the FriendlyName of the up adapter holding
// the default IPv4 gateway. Go's net.InterfaceByName matches against
// FriendlyName on Windows, so the shared interfaceIPv4 resolves it unchanged.
func defaultRouteInterface() (string, error) {
	var size uint32
	err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, 0, 0, nil, &size)
	if err != nil && err != windows.ERROR_BUFFER_OVERFLOW {
		return "", err
	}
	if size == 0 {
		return "", nil
	}
	var buf []byte
	var adapters *windows.IpAdapterAddresses
	for {
		buf = make([]byte, size)
		adapters = (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
		err = windows.GetAdaptersAddresses(windows.AF_UNSPEC, 0, 0, adapters, &size)
		if err == nil {
			break
		}
		if err != windows.ERROR_BUFFER_OVERFLOW {
			return "", err
		}
	}
	for adapter := adapters; adapter != nil; adapter = adapter.Next {
		if adapter.OperStatus != windows.IfOperStatusUp {
			continue
		}
		hasIPv4Gateway := false
		for gateway := adapter.FirstGatewayAddress; gateway != nil; gateway = gateway.Next {
			if ip := gateway.Address.IP(); ip != nil && ip.To4() != nil && !ip.IsUnspecified() {
				hasIPv4Gateway = true
				break
			}
		}
		if !hasIPv4Gateway {
			continue
		}
		hasIPv4 := false
		for unicast := adapter.FirstUnicastAddress; unicast != nil; unicast = unicast.Next {
			if ip := unicast.Address.IP(); ip != nil && ip.To4() != nil && !ip.IsLoopback() {
				hasIPv4 = true
				break
			}
		}
		if !hasIPv4 {
			continue
		}
		if name := windows.UTF16PtrToString(adapter.FriendlyName); name != "" {
			return name, nil
		}
	}
	return "", nil
}
