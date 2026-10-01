package vigem

import (
	"sync"
	"testing"
)

type fakeCall struct {
	name   string
	report Report
}

type fakeDLL struct {
	mu      sync.Mutex
	calls   []fakeCall
	client  uintptr
	target  uintptr
	index   uint32
	connErr uint32
}

func newFakeDLL() *fakeDLL {
	return &fakeDLL{client: 0xC11E47, target: 0x7A86E7, index: 3, connErr: VigemErrorNone}
}

func (f *fakeDLL) record(name string, report Report) {
	f.mu.Lock()
	f.calls = append(f.calls, fakeCall{name: name, report: report})
	f.mu.Unlock()
}

func (f *fakeDLL) api() *dllAPI {
	return &dllAPI{
		alloc: func() uintptr {
			f.record("alloc", Report{})
			return f.client
		},
		free: func(client uintptr) {
			f.record("free", Report{})
		},
		connect: func(client uintptr) uint32 {
			f.record("connect", Report{})
			return f.connErr
		},
		disconnect: func(client uintptr) {
			f.record("disconnect", Report{})
		},
		x360Alloc: func() uintptr {
			f.record("x360Alloc", Report{})
			return f.target
		},
		add: func(client, target uintptr) uint32 {
			f.record("add", Report{})
			return VigemErrorNone
		},
		remove: func(client, target uintptr) uint32 {
			f.record("remove", Report{})
			return VigemErrorNone
		},
		freeTarget: func(target uintptr) {
			f.record("freeTarget", Report{})
		},
		update: func(client, target uintptr, report *Report) uint32 {
			f.record("update", *report)
			return VigemErrorNone
		},
		registerNotify: func(client, target, callback, userData uintptr) uint32 {
			f.record("registerNotify", Report{})
			return VigemErrorNone
		},
		unregisterNotify: func(target uintptr) {
			f.record("unregisterNotify", Report{})
		},
		getIndex: func(target uintptr) uint32 {
			f.record("getIndex", Report{})
			return f.index
		},
	}
}

func TestFakeDLLConnectFailureSurfacesTypedError(t *testing.T) {
	fake := newFakeDLL()
	fake.connErr = VigemErrorBusNotFound
	api := fake.api()
	client := api.alloc()
	if code := api.connect(client); code != VigemErrorBusNotFound {
		t.Fatalf("code = %#x, want BUS_NOT_FOUND", code)
	}
	if err := Error(VigemErrorBusNotFound); err.Error() == "" {
		t.Fatal("typed error string is empty")
	}
}
