.PHONY: lint lint-brand-vocabulary lint-boundaries lint-no-style lint-no-class-ternary lint-no-data-interpolation lint-no-bind-ternary lint-no-div-popover lint-no-div-role-status lint-templates fix test check verify-bundle-isolation

## lint: biome lint + format check + stylelint + typecheck + brand-vocabulary + import-boundaries (matches CI)
lint: lint-brand-vocabulary lint-boundaries
	npx biome lint src admin organizer shared test
	npx biome format src admin organizer shared test
	npm run lint:css
	# Invoke the project's TypeScript 5.x compiler directly. `npx tsc` is
	# ambiguous: `@aurelia/vite-plugin`'s `plugin-conventions` pulls a transitive
	# `@typescript/typescript6` (TS 6.0) whose `tsc` bin can win the
	# `node_modules/.bin/tsc` symlink and reject this repo's tsconfig (node10 /
	# baseUrl are removed in TS 6). Pin to the installed `typescript` package.
	node ./node_modules/typescript/bin/tsc --noEmit

## lint-boundaries: enforce src/ <-> admin/ <-> organizer/ isolation (only shared/ crosses)
lint-boundaries:
	npx depcruise src admin organizer shared test

## lint-brand-vocabulary: enforce entity.* i18n namespace parity and known-entity rules
lint-brand-vocabulary:
	npx tsx scripts/check-brand-vocabulary.ts

## fix: auto-fix formatting and lint issues
fix:
	npx biome check --write src test

## test: unit + scripts projects with coverage (Vitest 4 test.projects layout)
## The `storybook` browser project is gated separately in CI (test-storybook).
test:
	npx vitest run --coverage --project=unit --project=scripts

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

## lint-no-div-popover: popover must use <dialog>, not <div> (multi-line aware)
lint-no-div-popover:
	! grep -Pzo '(?s)<div\b[^>]*\bpopover\b' -r --include='*.html' src/

## lint-no-div-role-status: status must use <output>, not <div> (multi-line aware)
lint-no-div-role-status:
	! grep -Pzo '(?s)<div\b[^>]*\brole="status"' -r --include='*.html' src/

## lint-templates: all template lint rules
lint-templates: lint-no-style lint-no-class-ternary lint-no-data-interpolation lint-no-bind-ternary lint-no-div-popover lint-no-div-role-status

## verify-bundle-isolation: build then assert the consumer entry graph
## contains no admin-origin chunk (OpenSpec `add-admin-console`, design D2) and
## no Temporal polyfill (OpenSpec `introduce-swappable-plain-date-lib`, D5).
verify-bundle-isolation:
	npm run build
	npm run verify:bundle-isolation
	npm run verify:no-temporal-polyfill

## check: full local pre-commit check.
## Mirrors CI's fast lanes (Lint + Test). Playwright suites (smoke / e2e /
## visual) are CI-only — they require browser binaries, baseline screenshots
## from CI artifacts, and a running dev server, none of which are
## deterministic in pre-commit. Run those locally on demand via
## `npx playwright test --project=<name>`.
check: lint lint-templates test verify-bundle-isolation
