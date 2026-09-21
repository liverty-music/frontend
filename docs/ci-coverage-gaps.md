# E2E coverage gaps

The `ci-optimization` capability requires that every Playwright project **and
every individual spec** is either executed by CI or recorded here as a known
gap with a named control. A spec that no executed project matches is uncovered
even when every project passes, so this list is maintained at spec granularity,
not project granularity.

It exists because automated dependency merges treat a green `CI Success` as
authority to merge. Anything on this list is **not** verified by that gate, and
the automerge policy in the `dependency-update-automation` capability must
withhold the dependencies it governs.

## This list is enforced

```bash
npm run verify:e2e-coverage   # wired into `make lint`
```

`scripts/verify-e2e-coverage.ts` derives the executed set by reading which
projects the workflows actually invoke, then diffs it against every spec on
disk. It fails on three things:

| failure | meaning |
|---|---|
| `empty-project` | CI runs a project that matches no spec — it verifies nothing |
| `uncovered-spec` | a spec no project runs, and no gap below records |
| `stale-gap` | a gap entry that is now covered, or names a deleted spec |

The project list is derived, never hardcoded: a hardcoded one would claim full
coverage while CI ran something else, which is the exact failure this check
exists to catch.

`empty-project` is checked separately from the coverage diff on purpose. An
empty project removes nothing from the uncovered set, so a diff alone reports
success — which is how `pwa` ran **0 tests in 0 files** while CI called it
green, for as long as all three of its specs sat in `testIgnore`.

Adding a gap means editing `KNOWN_GAPS` in that script AND this file. The
script holds the machine-checkable claim; this file holds the reasoning and the
named control.

## What CI executes

| Config | Projects | Where |
|---|---|---|
| `playwright.config.mjs` | `functional`, `webkit-repro`, `chromium-control` | `ci.yaml` → `e2e` job |
| `playwright.config.mjs` | `smoke`, `onboarding` | `ci.yaml` → `smoke` job |
| `playwright.pwa.config.mjs` | `pwa` | `ci.yaml` → `e2e` job, "Run PWA tests" |
| `playwright.smoke.config.mjs` | `post-deploy` | `push-image.yaml`, against the deployed URL |

## Known gaps

| Spec | Why it cannot run in CI | Named control | Dependencies left unverified |
|---|---|---|---|
| `e2e/pwa/pwa-install-prompt.spec.ts` | `beforeinstallprompt` fires only once Chromium's install heuristics are satisfied. Headless CI never satisfies them, and Playwright exposes no API to synthesise the event. | **None today.** Not human review — a reviewer reading a version bump sees strictly less than the pipeline does. | `vite-plugin-pwa` *manifest / install-prompt* behaviour only. Precaching is covered (see below). |
| `e2e/pwa/pwa-settings.spec.ts` | Needs `storageState` from `npm run auth:capture:password`, which drives a real OIDC login with a credential held in ESC. CI cannot obtain it; `.auth/` is gitignored. | **None today.** | Push-notification settings UI. Not a workbox control — the spec stubs `navigator.serviceWorker` wholesale, so it asserts nothing about a real service worker even when it does run. |

Both gaps are recorded against the `authenticated` project and the
`playwright.pwa.config.mjs` `testIgnore` respectively, at the point of
exclusion, as the capability requires.

## Gaps that were closed

Recorded so the reasoning is not re-litigated, and so a stale exclusion reason
is not re-inherited.

- **`e2e/pwa/pwa-offline-cache.spec.ts`** was excluded as "Requires Service
  Worker + offline — not available in CI headless". That reason was wrong:
  `context.setOffline()` is a core Playwright API that works in headless
  Chromium. The *real* obstacle was different — `vite.config.ts` sets
  vite-plugin-pwa's `devOptions.enabled: false`, and the e2e web server is `npm
  start`, so no service worker existed in the environment the spec ran against.
  Closed by running the PWA specs from `playwright.pwa.config.mjs` against
  `vite preview` over a production build.

  The spec's assertions were rewritten at the same time. It previously asserted
  `expect(bodyText).toBeTruthy()` — a check that passes when no service worker
  was ever registered, and could therefore never have detected a workbox
  regression. It now asserts that the service worker reaches `activated` and
  controls the page, and that the precache holds the app shell and its route
  chunks.

  It does **not** assert offline *navigation*. Playwright's offline emulation
  fails the top-level navigation before the service worker is consulted
  (`net::ERR_INTERNET_DISCONNECTED`), and with `registerType: 'prompt'` the
  worker does not always control the client at that moment. Precache contents
  are what a `workbox` / `vite-plugin-pwa` upgrade actually breaks, so that is
  what is asserted.

- **`e2e/functional/page-help-sheet-webkit.spec.ts`** had zero coverage: the
  `functional` project excluded it as "Covered by webkit-repro /
  chromium-control", and no CI job invoked either of those projects. Closed by
  adding both to the `e2e` job.

  The spec had rotted while unrun and needed three repairs: the help trigger had
  moved from the page header into the FAB launcher, `.sheet-body` had become
  ambiguous (`error-banner` mounts its own `bottom-sheet`), and the first-visit
  help auto-open had to be suppressed to reach the state under test.

## Open defect

`webkit-repro` is **intermittently red**: measured 8 passes / 2 failures over 10
local runs, against 3/3 for `chromium-control`. The failure is the regression
the spec exists to catch — the page-help bottom sheet dismisses itself shortly
after opening, on real WebKit only. The `IntersectionObserver` "just-opened"
guard that was supposed to fix it does not hold reliably.

CI's `retries: 2` will usually mask this. It should not be treated as a flaky
test to be retried away: it is an intermittent product defect on the engine
every iOS browser uses. Until it is fixed, this spec is a weak gate.
