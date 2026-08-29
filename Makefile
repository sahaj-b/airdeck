SHELL := /bin/sh

GO_FILES := cmd/main.go tools/lanbench/main.go $(shell find internal -type f -name '*.go' ! -path 'internal/uinput/*' | sort)

.PHONY: sync-contracts web-build build test lint fmt bench

sync-contracts:
	node scripts/sync-contracts.mjs
	go run github.com/gzuidhof/tygo@v0.2.21 generate

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
	go run github.com/gzuidhof/tygo@v0.2.21 generate
	git diff --exit-code -- web/src/shared/generated
	go vet ./...
	pnpm --dir web typecheck
	pnpm --dir web lint

fmt:
	gofumpt -w $(GO_FILES)
	pnpm --dir web format

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
