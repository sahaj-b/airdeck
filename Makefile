SHELL := /bin/sh

GO_FILES := cmd/main.go tools/lanbench/main.go $(shell find internal -type f -name '*.go' ! -path 'internal/uinput/*' | sort)

.PHONY: sync-contracts web-build build test lint fmt bench

sync-contracts:
	node scripts/sync-contracts.mjs

web-build: sync-contracts
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web build

build: web-build
	go build -o airdeck ./cmd

test:
	go test ./...
	pnpm --dir web test

lint:
	node scripts/sync-contracts.mjs --check
	go vet ./...
	pnpm --dir web typecheck
	pnpm --dir web lint

fmt:
	gofumpt -w $(GO_FILES)
	pnpm --dir web format

bench:
	go run ./tools/lanbench --advertised-url "$(ADVERTISED_URL)" --session-code "$(SESSION_CODE)" --players "$(PLAYERS)" --duration "$(DURATION)" --rate "$(RATE)" --output "$(OUTPUT)" --admin-url "$(ADMIN_URL)"
