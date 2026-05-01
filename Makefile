.PHONY: lint lint-brand-vocabulary lint-no-style lint-no-class-ternary lint-no-data-interpolation lint-no-bind-ternary lint-no-div-popover lint-no-div-role-status lint-templates fix test check

## lint: biome lint + format check + stylelint + typecheck + brand-vocabulary (matches CI)
lint: lint-brand-vocabulary
	npx biome lint src test
	npx biome format src test
	npm run lint:css
	npx tsc --noEmit

## lint-brand-vocabulary: enforce entity.* i18n namespace parity and known-entity rules
lint-brand-vocabulary:
	npx tsx scripts/check-brand-vocabulary.ts

## fix: auto-fix formatting and lint issues
fix:
	npx biome check --write src test

## test: unit tests with coverage
test:
	npx vitest run --coverage

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

## check: full local pre-commit check.
## Mirrors CI's fast lanes (Lint + Test). Playwright suites (smoke / e2e /
## visual) are CI-only — they require browser binaries, baseline screenshots
## from CI artifacts, and a running dev server, none of which are
## deterministic in pre-commit. Run those locally on demand via
## `npx playwright test --project=<name>`.
check: lint lint-templates test
