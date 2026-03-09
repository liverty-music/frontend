.PHONY: lint fix test test-layout test-layout-auth check

## lint: biome lint + format check + stylelint + typecheck (matches CI)
lint:
	npx biome lint src test
	npx biome format src test
	npm run lint:css
	npx tsc --noEmit

## fix: auto-fix formatting and lint issues
fix:
	npx biome check --write src test

## test: unit tests with coverage
test:
	npx vitest run --coverage

## test-layout: Playwright layout assertions (mock RPC, no auth required)
test-layout:
	npx playwright test --project=mobile-layout

## test-layout-auth: Playwright layout assertions for authenticated routes
## Requires .auth/storageState.json — run `npx tsx scripts/capture-auth-state.ts` first
test-layout-auth:
	npx playwright test --project=authenticated-mobile

## check: full local pre-commit check (lint + test + layout)
## Note: test-layout-auth excluded — requires manual storageState capture
check: lint test test-layout
