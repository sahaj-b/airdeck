package vigem

// dllAPI holds the ViGEm entry points as plain function fields. Production
// wires the real LazyDLL procs via loadDLL.
type dllAPI struct {
	alloc            func() uintptr
	free             func(client uintptr)
	connect          func(client uintptr) uint32
	disconnect       func(client uintptr)
	x360Alloc        func() uintptr
	add              func(client, target uintptr) uint32
	remove           func(client, target uintptr) uint32
	freeTarget       func(target uintptr)
	update           func(client, target uintptr, report *Report) uint32
	registerNotify   func(client, target, callback, userData uintptr) uint32
	unregisterNotify func(target uintptr)
	getIndex         func(target uintptr) uint32
}
