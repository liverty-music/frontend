#!/usr/bin/env bash
# The checks the commit hook runs (`make pre-commit`): the lint of `make lint`
# and the Vitest specs named after the changed files. CI runs `make lint` and
# `make test` on the whole tree, so a spec that breaks through an indirect
# import is caught there.
#
# The whole unit suite took about 160 s on every commit, most of it Vitest
# transforming and importing every spec; `vitest --changed` was slower still,
# because it walks the import graph of every spec (measured 2026-11-12).
set -euo pipefail

# Changed files: staged, unstaged and untracked. The hook runs before a
# `git add ... && git commit` in the same command has staged anything.
changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u)
if [ -z "$changed" ]; then
	exit 0
fi

# Lint: everything `make lint` runs. The e2e coverage scan lists every
# Playwright spec (about 24 s), so it runs only when a spec or the Playwright
# configuration changes.
make --no-print-directory lint-brand-vocabulary lint-boundaries lint-route-loading
if grep -qE '^(e2e/|playwright[^/]*\.config\.mjs$|scripts/verify-e2e-coverage)' <<<"$changed"; then
	make --no-print-directory lint-e2e-coverage
fi
npx biome lint src admin organizer reception shared test e2e
npx biome format src admin organizer reception shared test e2e
npm run --silent lint:css
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/typescript/bin/tsc --noEmit -p e2e

# Tests: a change to the test setup or the dependencies can break any spec,
# so it runs the whole suite.
vitest=(npx vitest run --project=unit --project=scripts --passWithNoTests)
if grep -qE '^(vitest\.config\.ts|test/setup[^/]*\.ts|package(-lock)?\.json|tsconfig[^/]*\.json)$' <<<"$changed"; then
	exec "${vitest[@]}"
fi

# Otherwise the specs whose path contains the name of a changed source file:
# Vitest filters match a substring of the spec path, so `artist-mapper` selects
# both src/**/artist-mapper.spec.ts and test/**/artist-mapper.spec.ts. A
# component's .ts, .html and .css share one name, and scripts/<name>.lib.ts is
# tested by scripts/<name>.spec.ts.
names=$(grep -E '^(src|admin|organizer|reception|shared|scripts|test|stylelint-plugin-cube-css)/.*\.(ts|js|html|css)$' <<<"$changed" |
	sed -E 's#.*/##; s/\.(spec|test|node\.spec)\.(ts|js)$//; s/\.(ts|js|html|css)$//; s/\.lib$//' | sort -u || true)
if [ -z "$names" ]; then
	exit 0
fi
# shellcheck disable=SC2086 # one filter per name
exec "${vitest[@]}" $names
