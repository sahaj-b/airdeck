//go:build windows

package vigem

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// dllName is the ViGEmClient.dll shipped next to airdeck.exe.
const dllName = "ViGEmClient.dll"

// defaultDLLPath resolves the DLL beside the running exe. Windows searches
// the exe dir first so the bare name would usually work, but an absolute
// path removes CWD and PATH ambiguity plus DLL-hijack surprises when
// airdeck is launched from a shortcut or a different working dir.
func defaultDLLPath() string {
	exe, err := os.Executable()
	if err != nil {
		return dllName
	}
	return filepath.Join(filepath.Dir(exe), dllName)
}

func loadDLL(path string) (*dllAPI, error) {
	if path == "" {
		path = defaultDLLPath()
	}
	dll := windows.NewLazyDLL(path)
	names := []string{
		"vigem_alloc",
		"vigem_free",
		"vigem_connect",
		"vigem_disconnect",
		"vigem_target_x360_alloc",
		"vigem_target_add",
		"vigem_target_remove",
		"vigem_target_free",
		"vigem_target_x360_update",
		"vigem_target_x360_register_notification",
		"vigem_target_x360_unregister_notification",
		"vigem_target_get_index",
	}
	procs := make(map[string]*windows.LazyProc, len(names))
	for _, name := range names {
		proc := dll.NewProc(name)
		if err := proc.Find(); err != nil {
			return nil, fmt.Errorf("vigem: load %s from %s: %w", name, path, err)
		}
		procs[name] = proc
	}
	api := &dllAPI{}
	api.alloc = func() uintptr {
		ret, _, _ := procs["vigem_alloc"].Call()
		return ret
	}
	api.free = func(client uintptr) {
		_, _, _ = procs["vigem_free"].Call(client)
	}
	api.connect = func(client uintptr) uint32 {
		ret, _, _ := procs["vigem_connect"].Call(client)
		return uint32(ret)
	}
	api.disconnect = func(client uintptr) {
		_, _, _ = procs["vigem_disconnect"].Call(client)
	}
	api.x360Alloc = func() uintptr {
		ret, _, _ := procs["vigem_target_x360_alloc"].Call()
		return ret
	}
	api.add = func(client, target uintptr) uint32 {
		ret, _, _ := procs["vigem_target_add"].Call(client, target)
		return uint32(ret)
	}
	api.remove = func(client, target uintptr) uint32 {
		ret, _, _ := procs["vigem_target_remove"].Call(client, target)
		return uint32(ret)
	}
	api.freeTarget = func(target uintptr) {
		_, _, _ = procs["vigem_target_free"].Call(target)
	}
	// XUSB_REPORT is 12 bytes, so under the MS x64 convention this by-value
	// struct arg travels as a pointer. Pass the report address.
	api.update = func(client, target uintptr, report *Report) uint32 {
		ret, _, _ := procs["vigem_target_x360_update"].Call(client, target, uintptr(unsafe.Pointer(report)))
		return uint32(ret)
	}
	api.registerNotify = func(client, target, callback, userData uintptr) uint32 {
		ret, _, _ := procs["vigem_target_x360_register_notification"].Call(client, target, callback, userData)
		return uint32(ret)
	}
	api.unregisterNotify = func(target uintptr) {
		_, _, _ = procs["vigem_target_x360_unregister_notification"].Call(target)
	}
	api.getIndex = func(target uintptr) uint32 {
		ret, _, _ := procs["vigem_target_get_index"].Call(target)
		return uint32(ret)
	}
	return api, nil
}
