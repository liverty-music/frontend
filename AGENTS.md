<poly-repo-context repo="frontend">
  <responsibilities>Aurelia 2 single-page PWA for music fans. Vite build, CUBE CSS methodology,
  Biome linter, Zitadel OIDC auth, Vitest + Playwright testing.</responsibilities>
  <essential-commands>
    make lint              # Biome lint + format check + stylelint + typecheck + brand-vocabulary (matches CI)
    make fix               # Auto-fix formatting (biome check --write)
    make test              # unit + scripts vitest projects with coverage
    make check             # Full pre-commit check (lint + test)
    npm run test-storybook # Storybook component tests (browser mode; run in the pinned Playwright container for visual baselines)
    npm start              # Dev server
    npm run storybook      # Storybook dev UI (port 6006)
    npm run build          # Production build
    npx playwright test    # E2E tests (functional/smoke/onboarding/pwa — no visual project)
  </essential-commands>
</poly-repo-context>

<agent-rules>

## Consuming New Proto Types (after BSR gen)

When a specification Release has published new schema to BSR (see the
specification repo's AGENTS.md for the cross-repo release flow), upgrade and
adopt the generated types here:

```bash
# Install the released schema package (pin the version when needed)
npm install @buf/liverty-music_schema.connectrpc_es@latest
make check
```

Then swap the placeholder types for the generated ones at each
`TODO: swap to generated type after BSR gen` marker and run `make check` again.
Open (or push) the PR only after this succeeds — do NOT open a draft PR before
BSR gen completes, as CI will fail on the missing types.

## Stack

| Stack            | Technology                                           |
|------------------|------------------------------------------------------|
| **Framework**    | Aurelia 2 (`aurelia`, `@aurelia/router`)              |
| **Build**        | Vite (`@aurelia/vite-plugin`)                         |
| **Styling**      | CUBE CSS methodology (`@layer`, `@scope`)             |
| **Linter**       | Biome (`@biomejs/biome`)                              |
| **Auth**         | Zitadel via `oidc-client-ts`                          |
| **Testing**      | Vitest 4 `test.projects` (unit/scripts/storybook) + `@aurelia/testing`, Playwright (E2E) |
| **Stories**      | Storybook 10 (`@aurelia/storybook` 3) — CSF3 component tests + a11y + visual (see below) |

## File Organization

```
src/
  app-shell.ts / .html       # Shell component + route definitions
  main.ts                     # Aurelia bootstrap + DI registrations
  routes/
    auth-callback.ts / .html  # OAuth callback handler
    artist-discovery/         # Onboarding discovery page
  components/
    auth-status.ts / .html    # Auth status display
    dna-orb/                  # Canvas-based artist discovery (Matter.js physics)
    bottom-sheet/             # Shared bottom-sheet dialog primitive
    loading-spinner/          # Shared loading indicator
    snack-bar/                # App-level snack notifications
    toast/                    # Shared popover banner primitive
  services/
    auth-service.ts           # Zitadel OIDC integration
    lastfm-service.ts         # Last.fm API client
    artist-discovery-service.ts # Discovery state management
```

## Aurelia 2 Conventions

Aurelia 2 coding conventions (DI, events, lifecycle, routing, templates, logging) are defined
in the `aurelia2-component` skill. Read it before writing any component code.

## Component Stories & Testing (Storybook + Vitest)

Testing runs as Vitest 4 `test.projects` in a single `vitest.config.ts`:

| Project     | Env                  | Runs                                        | Command |
|-------------|----------------------|---------------------------------------------|---------|
| `unit`      | jsdom                | `**/*.spec.ts` (+ coverage, thresholds)     | `make test` / `npm test` |
| `scripts`   | node (no polyfills)  | `scripts/**/*.spec.ts` (real `node:*`)      | `npm run test:scripts` |
| `storybook` | Chromium (Playwright)| CSF stories as component tests              | `npm run test-storybook` |

- `make test` runs `unit` + `scripts` only; `storybook` is a separate CI job (`storybook-test`).
- Coverage thresholds: statements/functions/lines 70, **branches 60** (Vitest 4's `ast-v8` branch
  remapping counts far more branches than v2 — recalibrated, not a real regression).
- Node 25's broken Web Storage stub is replaced by a polyfill in `test/setup.ts` (Vitest 4 no longer
  forwards `--no-experimental-webstorage` to workers); a `matchMedia` stub lives there too.

### Story-authoring scope

Story **only presentational custom elements under `src/components/`** — components whose render is a
pure function of their `@bindable` inputs. Story files are colocated: `src/components/<name>/<name>.stories.ts`
(CSF3, `satisfies Meta<typeof X>` / `StoryObj<typeof meta>`), tagged `['test', 'autodocs']`.

- Enumerate each visually distinct state as a named story; expose `@bindable`s as `argTypes` controls.
- Add `play` functions (`storybook/test`: `expect`/`within`/`userEvent`) for interaction assertions.
- a11y (axe) runs on every story and **fails** on violations (`.storybook/story-annotations.ts` sets
  `a11y.test: 'error'`; wired in `.storybook/vitest.setup.ts`).
- Shared config (i18n, global `svg-icon`/`bottom-sheet` registration, a11y param) lives in
  `.storybook/story-annotations.ts` — parameters inside `definePreview` do NOT propagate through
  `setProjectAnnotations`, so that module is composed as a plain trailing annotation in the setup file.
- For DI/child-bound components use `defineAureliaStory({ template, props, register, items })` — e.g.
  register an `IErrorBoundaryService`/`I18N` mock via `items`, or drive an EA-published component from a host.

**Do NOT story**: route/page components, `dna-orb` (canvas/Matter.js), or anything requiring live
RPC/auth/canvas context. The previous route-targeted story was removed.

### Visual regression

Component-level only, via Vitest browser `expect.element(el).toMatchScreenshot()` (pixelmatch,
`allowedMismatchedPixelRatio: 0.001`) on the static design-system subset (svg-icon, inline-error,
state-placeholder, page-header). Baselines are **committed** under
`src/components/*/__screenshots__/**/*-chromium-linux.png` and reviewed in the PR diff (no CI artifact).

- Generate/compare baselines INSIDE the pinned container so rendering is deterministic with CI:
  ```bash
  # regenerate after an intentional visual change, then commit the PNGs
  docker run --rm -v "$PWD":/work -w /work -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.58.1-noble \
    npx vitest run --project=storybook --update
  ```
- The `storybook-test` CI job runs in that same image; on failure it uploads the Vitest HTML report
  (`storybook-test-report/`, which embeds the diff/actual images). Page-level visual regression
  (the old Playwright `mobile-visual`) has been retired — one visual pipeline only.

## Playwright MCP (Authenticated E2E Testing)

All routes require authentication by default (`AuthHook` in `src/hooks/auth-hook.ts`). Public routes explicitly set `data: { auth: false }` in route config.

The dev Zitadel hosts a single Pulumi-managed test user for E2E:

| Test user | Auth | Capture command |
|---|---|---|
| `e2e-test-password@dev.liverty-music.app` | Username + password | `npm run auth:capture:password` |

Capture runs headless against `https://auth.dev.liverty-music.app` — no display server required, works on macOS / Linux / WSL2 + WSLg / CI runners. The script writes `.auth/storageState.json`, which the `playwright-auth` MCP server (configured in `.claude/settings.json`) consumes automatically.

Setup:

1. Retrieve the password from ESC once and mirror it locally:
   ```bash
   esc env get liverty-music/dev pulumiConfig.zitadel.e2eTestUser.password --show-secrets
   # write the value into frontend/.auth/password.md (gitignored)
   ```
2. Start the dev server: `npm start`
3. Run: `npm run auth:capture:password`

The script is fully headless, drives the OIDC username/password flow, and self-verifies (atomic write — fails non-zero without destroying any prior working `storageState.json`). See [`frontend/.auth/README.md`](.auth/README.md) for the full setup, rotation protocol, and credential-file conventions.

If navigation to a protected route redirects away from the requested page, the storageState has likely expired. Re-run the capture script.

## Key Technical Decisions

### 1. Canvas + Matter.js for Artist Discovery

The artist discovery bubble UI uses HTML5 Canvas 2D with Matter.js physics engine. This was chosen over DOM-based animation for performance with 30+ animated elements on mobile. See `src/components/dna-orb/`.

### 2. Direct Last.fm API Calls

Last.fm API is called directly from the frontend (client-side). The API key is public/read-only by design. Calls use 300ms debounce and in-memory caching.

### 3. DI + Service State Management

Application state (onboarding progress, guest artist data) is managed through singleton services with Aurelia's native DI and observation. `OnboardingService` and `GuestService` own their state as `@observable` properties, hydrate from localStorage on construction, and persist via explicit storage functions in `src/adapter/storage/`. No external state library is used — Aurelia's built-in observation system handles reactivity.

### 4. Onboarding Flow via OIDC Sign-Up Detection

New vs returning users are distinguished by the `isSignUp` flag in the OIDC state. The auth callback routes sign-up users to artist discovery and sign-in users directly to the dashboard.

## Review criteria (flag violations; quote the rule + link the existing code compared against)

- No direct `localStorage` in services — persist `@observable` state via `src/adapter/storage/` (cf. `follow-store.ts`).
- A route reachable without auth MUST set `data: { auth: false }` in `app-shell.ts`; the gate lives in `auth-hook.ts`, not components.
- Any `attached()` that adds a listener / starts a `requestAnimationFrame` / subscribes MUST release it in `detaching()` (cf. `concert-highway.ts`).
- RPC goes through a client in `src/adapter/rpc/client/` built with `createTransport`; auth is at the transport, not the call site.
- Services export an `IName` token via `DI.createInterface()`, register `.singleton()`, and re-export the interface (cf. `concert-store.ts`).
- `@observable` mutations update optimistically and roll back on RPC failure (cf. `follow-store.ts follow()`).
- ConnectError is routed via `IConnectErrorRouter`, not swallowed in a component.

</agent-rules>
