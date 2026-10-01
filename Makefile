SHELL := /bin/sh

GO_FILES := $(shell find cmd internal tools -type f -name '*.go' | sort)

.PHONY: sync-contracts web-build build relay build-windows vet-windows release-windows dev test lint fmt bench

sync-contracts:
	node scripts/sync-contracts.mjs
	go run github.com/gzuidhof/tygo@v0.2.21 generate

web-build: sync-contracts
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web build

build: web-build
	go build -o airdeck ./cmd

relay:
	go build -o signal-relay ./cmd/signal-relay

build-windows: web-build
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o dist-windows/airdeck.exe ./cmd

vet-windows:
	GOOS=windows GOARCH=amd64 go vet ./...

release-windows: build-windows
	@set -eu; \
		test -f ViGEmClient.dll || { echo "missing ViGEmClient.dll" >&2; exit 1; }; \
		set -- Drivers/ViGEmBus_*.exe; \
		test -f "$$1" || { echo "missing Drivers/ViGEmBus_*.exe" >&2; exit 1; }; \
		test "$$(printf '%s\n' "$$@" | wc -l)" -eq 1 || { echo "multiple ViGEmBus installers found" >&2; exit 1; }; \
		find dist-windows -mindepth 1 -maxdepth 1 ! -name airdeck.exe -exec rm -rf {} +; \
		mkdir -p dist-windows/Drivers; \
		cp ViGEmClient.dll dist-windows/; \
		cp "$$1" dist-windows/Drivers/; \
		cp third_party/vigem/README.md dist-windows/Drivers/; \
		(cd dist-windows && zip -qr ../airdeck-windows.zip .)

test:
	go test ./...
	pnpm --dir web test

lint:
	node scripts/sync-contracts.mjs --check
	go run github.com/gzuidhof/tygo@v0.2.21 generate
	git diff --exit-code -- web/src/shared/generated
	go vet ./...
	pnpm --dir web typecheck
	pnpm --dir web lint

fmt:
	gofumpt -w $(GO_FILES)
	pnpm --dir web format

dev:
	air -c .air.toml & \
	GO_PID=$$!; \
	PORT=$${AIRDECK_PORT:-6969}; \
	for i in $$(seq 1 50); do \
		if curl -sf http://127.0.0.1:$$PORT/api/admin/state >/dev/null 2>&1; then break; fi; \
		if ! kill -0 $$GO_PID 2>/dev/null; then echo "air failed to start"; wait $$GO_PID; exit 1; fi; \
		sleep 0.2; \
	done; \
	AIRDECK_DEV=1 AIRDECK_PORT=$$PORT pnpm --dir web dev & \
	VITE_PID=$$!; \
	trap 'kill $$GO_PID $$VITE_PID 2>/dev/null; exit' INT TERM; \
	wait $$GO_PID; \
	kill $$VITE_PID 2>/dev/null; wait $$VITE_PID 2>/dev/null

PLAYERS ?= 1
DURATION ?= 5s
RATE ?= 60
OUTPUT ?= benchmarks/lanbench.json

bench:
	go run ./tools/lanbench \
		$(if $(ADVERTISED_URL),--advertised-url "$(ADVERTISED_URL)",) \
		$(if $(SESSION_CODE),--session-code "$(SESSION_CODE)",) \
		--players "$(PLAYERS)" --duration "$(DURATION)" --rate "$(RATE)" --output "$(OUTPUT)" \
		$(if $(ADMIN_URL),--admin-url "$(ADMIN_URL)",)
