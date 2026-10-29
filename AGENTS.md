<poly-repo-context repo="frontend">
  <responsibilities>Aurelia 2 single-page PWA for music fans. Vite build, CUBE CSS methodology,
  Biome linter, Zitadel OIDC auth, Vitest + Playwright testing.</responsibilities>
  <essential-commands>
    npm run test-storybook # Storybook component tests (browser mode; run in the pinned Playwright container for visual baselines)
    npx playwright test    # E2E tests (functional/smoke/onboarding/pwa — no visual project)
  </essential-commands>
</poly-repo-context>

<agent-rules>

## OpenSpec (planning lives in the store)

This repository carries no planning of its own. `openspec/config.yaml` declares `store: openspec-store` (the `liverty-music/specification` repository), so every `openspec` command run here resolves to that store; the `Using OpenSpec root: openspec-store` banner confirms it. The full workflow, local and cloud, is in the `specification` README ("Development workflow"); the rules that bind a session here are:

- **Before implementing**, read the change's artifacts and the affected specs in the store: `openspec show <change>`, `openspec instructions apply --change <change>`, and `openspec show <spec-id> --type spec`. Implement against the spec, not against memory.
- **Run `openspec doctor` first** on a fresh machine and at the start of every cloud thread. If the store is not registered, register a `specification` checkout: the sibling clone when one exists (`openspec store register "$(git rev-parse --show-toplevel)/../specification" --id openspec-store`, the layout of a multi-repo Claude Project thread), otherwise clone the public repo first (`git clone --depth 1 https://github.com/liverty-music/specification.git /tmp/openspec-store`) and register that path. Keep that checkout on `main` and pull it before implementing: OpenSpec never pulls.
- **Isolate local work with `claude --worktree <change>`** (`.claude/worktrees/<change>`, branch `worktree-<change>`). In `specification`, the main checkout is the shared store and stays on `main`; branch work there (plan PR, proto PR, archive) goes through its own worktrees (`specification` README "Branch work in this repository").
- **Record progress in the store, never commit there.** `/opsx:apply` checks off `tasks.md` and updates `design.md` in the `specification` checkout's working tree on `main`, uncommitted. Several changes share that working tree, so never run `git stash`, `git reset --hard`, `git checkout -- .` / `git restore .` or `git clean` there, never `git add -A` / `git add .`, and never switch its branch.
- **Every PR must cite its change**: fill the `OpenSpec-Change` (or `OpenSpec-Spec`) field and the store commit SHA in the PR template's OpenSpec Traceability section. One PR per repository.
- **Close-out happens in `specification`**, after every implementing PR has merged and the release is confirmed in production: `/opsx:verify`, then archive in a `<change>-archive` worktree of `specification`, staging only that change's paths (README "Lifecycle of a change", step 5). Do not archive from this repository.
- **Cloud threads run no repository hooks**: run `make check` before committing; CI is the gate.

## Cross-repo workflow (poly-repo)

This repo is one of four under `liverty-music/`: `specification` (proto schema + OpenSpec store), `backend`, `frontend`, `cloud-provisioning`. The full release process lives in the specification repo's AGENTS.md; the rules that bind work here are:

- **Dependency order**: specification PR merge → GitHub Release (`vX.Y.Z`) → BSR remote generation → this repo can build with the new types. Never generate protobuf code locally; consume it from BSR (see "Consuming New Proto Types" below).
- **Do not open a PR, even a draft, before BSR gen completes.** CI fails on the missing types and creates review noise. Prepare the branch locally and push only after the generated package is upgraded and placeholder types are swapped. Exception: the user explicitly asks for parallel review; then annotate the PR with "Depends on BSR gen for vX.Y.Z".
- **Start downstream work early.** As soon as the proto surface is agreed (approved OpenSpec change or open specification PR), write UI, services and tests against the planned type shape, with local placeholders marked `TODO: swap to generated type after BSR gen`.
- Monitor BSR gen with `gh run list --repo liverty-music/specification --workflow buf-release.yml --limit 3`.

## Consuming New Proto Types (after BSR gen)

The frontend is on **protobuf-es / Connect-ES v2**. The generated code comes from
the single `@buf/liverty-music_schema.bufbuild_es` package (the v2 major folds the
old `connectrpc_es` connect codegen into `protoc-gen-es` output — there is **no**
`connectrpc_es` package anymore; service descriptors are exported from the
`*_service_pb.js` files alongside the messages).

Upgrade and placeholder-swap procedure: see the `consume-proto-release` skill.

Open (or push) the PR only after this succeeds — do NOT open a draft PR before
BSR gen completes, as CI will fail on the missing types.

### v2 codegen conventions (protobuf-es v2)

- Messages are plain objects, not classes: build with `create(FooSchema, { … })`
  from `@bufbuild/protobuf` (import `FooSchema` from the `*_pb.js` file). For a
  nested message field you may pass its plain init object directly
  (`{ eventId: { value: id } }`) instead of a nested `create()`.
- Connect clients use `createClient(Service, transport)` (the v1
  `createPromiseClient` / `PromiseClient` are gone); `Service` is imported from
  the generated `*_service_pb.js`, not a separate `*_connect.js`.
- Well-known `Timestamp` is a plain message with no methods: use `timestampDate`
  / `timestampFromDate` from `@bufbuild/protobuf/wkt` (the v1 `.toDate()` /
  `Timestamp.fromDate()` are gone).
- Enums remain TypeScript `enum`s, unchanged from v1.

## Aurelia 2 Conventions

General Aurelia 2 guidance comes from the `aurelia` skill (web-frontend plugin) and the docs
(`https://docs.aurelia.io/llms.txt`). This repository's choices on top of it:

- Inject with `resolve(IFoo)` as a property; no `@inject` and no constructor injection.
- Log through `resolve(ILogger).scopeTo('<ClassName>')`; `console.*` only before the logger
  exists (bootstrap failure in `main.ts`).
- A child tells its parent with a DOM event (`dispatchEvent(new CustomEvent(...))`) bound by
  `.trigger` in the parent template; no `.call` bindings.
- Components register by convention (matching `.ts` + `.html` pair); `@customElement` only to
  set a name or an imported template (cf. `src/components/icons/`). Template dependencies use
  `<import from="...">`.
- No `any` in `src/` (Biome `noExplicitAny`; tests are exempt).
- CSS rules live in `stylelint.config.js`, not here: the `@layer` order of `src/styles/main.css`,
  `@scope` per block, one block per file, `data-*` exceptions, single-property utilities,
  colour tokens (no hex, `rgb()` or `hsl()`), logical properties, container queries over width
  media queries, and no `z-index` or `!important` (the `cube/*` rules come from
  `stylelint-plugin-cube-css/`). Run `npm run lint:css` and read the failing rule's source in
  `stylelint-plugin-cube-css/lib/rules/` before working around it. Class attributes use CUBE
  bracket groups: `class="[ block ] [ composition ] [ utilities ]"`.

### Inline styles (CUBE CSS)

Styling lives in stylesheets (CUBE layers, `@scope`). A template MAY set **CSS custom
properties from data** inline, and nothing else: `style="--artist-hue: ${event.artistHue}"`
is allowed; `style="color: …"`, layout, or any other declaration is not. Compute the value
when the data is built (e.g. `Concert.artistHue`), not in a custom attribute that runs per
element — a custom attribute whose only job is to copy a value into a custom property adds
a controller to every element it sits on.

## Component Stories & Testing (Storybook + Vitest)

- `make test` runs `unit` + `scripts` only; both storybook projects (`storybook`, `storybook-reduced-motion`; see `vitest.config.ts`) run in a separate CI job (`storybook-test`).
- A story tagged `reduced-motion` runs in both storybook projects. It reads
  `matchMedia('(prefers-reduced-motion: reduce)')` and asserts the motion that matches, so one story
  covers both presentations.
- Coverage thresholds: statements/functions/lines 70, **branches 60** (Vitest 4's `ast-v8` branch
  remapping counts far more branches than v2 — recalibrated, not a real regression).
- Node 25's broken Web Storage stub is replaced by a polyfill in `test/setup.ts` (Vitest 4 no longer
  forwards `--no-experimental-webstorage` to workers); a `matchMedia` stub lives there too.

### Story-authoring scope

Story **only presentational custom elements under `src/components/`** — components whose render is a
pure function of their `@bindable` inputs. Story files are colocated: `src/components/<name>/<name>.stories.ts`
(CSF3, `satisfies Meta<typeof X>` / `StoryObj<typeof meta>`), tagged `['test', 'autodocs']`.

- Enumerate each visually distinct state as a named story; expose `@bindable`s as `argTypes` controls.
  **This is a contract, not a nicety**: adding a new visual state (a new `@bindable` that selects
  loading/skeleton, `variant`, `selected`/`pressed`, empty/error, etc.) REQUIRES adding a named story for
  it in the same change — otherwise the state ships untested and the story set silently drifts. When a
  storied component's `.ts`/`.html`/`.css` changes, re-check its stories still represent it.
- **Storybook fidelity**: `.storybook/preview.ts` imports `../src/styles/main.css`, so stories render with
  the SAME global M3 tokens + utilities (`@layer` tokens/global/utility) as the app — the shared axe
  `color-contrast` rule then verifies REAL role/`on-*` contrast, and global primitives (`.skeleton`,
  `[data-selected-morph]`, state layers) actually render. **Do NOT remove that import**; without it stories
  test token-less fallback rendering and both a11y and visual baselines become meaningless.
- **Global M3 primitives/tokens** (things in the `@layer` chain, not a single component) get their own
  `Foundations/*` story (see `src/styles/m3-primitives.stories.ts`) so new roles/utilities are contrast-
  and render-checked. Do NOT `toMatchScreenshot` an animated element (e.g. `.skeleton` shimmer) — the
  baseline is non-deterministic; assert DOM/a11y instead.
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

Baseline generation, the pinned container, and the CI job: see the `visual-baselines` skill.

## Build-time-only guards (run locally before release)

Some correctness checks run ONLY inside the Docker image build (`push-image.yaml`), not in `make check`
or PR CI, so they surface at deploy time if missed:

- `verify:build-templates` (`scripts/verify-build-templates.ts`) — asserts each route chunk still contains
  a template-derived marker (see `scripts/verify-build-templates.lib.ts` `ROUTE_MARKERS`), guarding against
  template stripping. **If you change a route's template structure (remove/rename a marker class/element),
  run `npm run build && npm run verify:build-templates` locally and update `ROUTE_MARKERS` if needed** — do
  not discover it at deploy. (A dashboard `loading-text` removal once broke the prod image build this way.)

## Organizer console guide (keep it in step)

The members' guide `organizer/guide/guide.html` (served at `/guide.html` on the
organizer origin) quotes the console's words and follows its flow, and
`specification/docs/organizer-console-story-map.md` is its source. **A change to
the organizer console's words or flow updates the matching chapter of the guide
and the developer document in the same change.** `test/organizer/guide.spec.ts`
catches a changed quoted word or a missing chapter id; reviewers check the rest
(order of steps, defaults, what the screens do not say) in the chapter of the
screen they change. A new screen gets its chapter in `organizer/guide/guide-link.ts`.

## Playwright MCP (Authenticated E2E Testing)

All routes require authentication by default (`AuthHook` in `src/hooks/auth-hook.ts`). Public routes explicitly set `data: { auth: false }` in route config.

Authenticated E2E setup (test user, `npm run auth:capture:password`, expired storageState): see the `e2e-auth` skill.

## npm `overrides` — exit conditions, not neglect

`package.json` carries two `overrides`, `playwright` and `playwright-core`.
Both are version bindings and move on upgrade. A security pin added in future
belongs here too, with its exit condition, and is resolved by REMOVAL rather
than by upgrade.

| entry | why | exit condition |
|---|---|---|
| `playwright` (same version as `@playwright/test`) | `@vitest/browser-playwright` peers `playwright: *`, so a lock regeneration resolves the newest release while the CI container ships only the browsers of `@playwright/test`'s version | none — it always equals `@playwright/test`; Renovate moves both in the `playwright` group |
| `playwright-core` (same version as `@playwright/test`) | `@axe-core/playwright` asks for `playwright-core >= 1.0.0`, so a lock refresh hoists the newest core while `playwright` keeps its pinned one nested; the two `Page` types then differ and `tsc -p e2e` fails (frontend#779) | none — it always equals `@playwright/test`; it is in the same Renovate `playwright` group |

**Keeping the upstream package current is the root-cause remedy** for a
security pin. When it widens its range, delete the override and let normal
resolution take over; do not replace it with a newer pin.

Renovate can raise the version *inside* an override but cannot decide that an
override should cease to exist, which is why `overrides` are excluded from
automerge in `renovate.json`. A pull request touching one is a request for that
judgement, not a routine bump.

Four earlier entries are gone for the same reason and are worth knowing about as
precedent: `bfj` was dead (its origin, snarkjs, left with the ZKP feature) and
was deleted with zero lockfile change; `minimatch` had an equally dead origin
but was NOT inert — it forced `filelist`'s transitive resolution five majors
above what `filelist` asked for — so removing it needed a lockfile regeneration
and a verification run rather than a deletion. `fflate: "0.4.9"` was the third:
once the advisory fix shipped as `0.4.9`, the newest release inside
`posthog-js`'s `^0.4.8`, normal resolution picked it without help, and a global
override was no longer protecting anything — it was forcing `@vitest/ui`, which
asks for `^0.8.2`, down onto the `0.4` line. Renovate's proposal to raise the
pin to `0.8.3` would have inverted that and pushed `posthog-js` out of its range
instead; deleting the override let each consumer resolve inside its own.
`dompurify: "^3.4.13"` was the fourth: `posthog-js` itself came to require
`^3.4.13`, the exact range the override forced, so the override did nothing
and was deleted with zero lockfile change.

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
- A ConnectError is never swallowed. An expected code becomes a state, mapped in the RPC client (cf. `wallet-public-key-client.ts` `get()`: NotFound → `null`) or in the route that shows it (cf. `checkout-route.ts` `explainAuthorizeCardFailure`); any other code is logged and shown as a retryable error, or rethrown.
- A screen reads every value it shows from the server by the resource's id (cf. `src/routes/order/order-route.ts` `loading` → `IOrderRpcClient`). The URL, history state and storage carry only ids and the user's own input (search terms, filters, `ref`); a display value such as a name, price or state is never handed from another screen. When no RPC returns the value, the read is missing from the change — raise it, do not work around it.

</agent-rules>
