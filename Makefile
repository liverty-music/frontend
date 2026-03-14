.PHONY: lint lint-no-style lint-no-class-ternary lint-no-data-interpolation lint-no-bind-ternary lint-templates fix test test-layout test-layout-auth check

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

## lint-no-style: ban style attributes in templates (CSS owns presentation)
lint-no-style:
	! grep -rn 'style[.= ]' --include='*.html' src/

## lint-no-class-ternary: ban class interpolation (use data-* instead)
lint-no-class-ternary:
	! grep -rn 'class="[^"]*$${' --include='*.html' src/

## lint-no-data-interpolation: ban data-* interpolation (use .bind)
lint-no-data-interpolation:
	! grep -rn 'data-[a-z-]*="[^"]*$${' --include='*.html' src/

## lint-no-bind-ternary: ban ternary in data-*.bind (pass state directly)
lint-no-bind-ternary:
	! grep -rn 'data-[a-z-]*\.bind="[^"]*?[^"]*"' --include='*.html' src/

## lint-templates: all template lint rules
lint-templates: lint-no-style lint-no-class-ternary lint-no-data-interpolation lint-no-bind-ternary

## check: full local pre-commit check (lint + test + layout + template rules)
## Note: test-layout-auth excluded — requires manual storageState capture
check: lint lint-templates test test-layout
