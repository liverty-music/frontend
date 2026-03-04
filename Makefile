.PHONY: lint fix test check

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

## check: full local pre-commit check (lint + test)
check: lint test
