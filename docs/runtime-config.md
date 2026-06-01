# Frontend Runtime Config

**Repository**: `liverty-music/frontend`
**Spec**: [`frontend-runtime-config`](https://github.com/liverty-music/specification/blob/main/openspec/specs/frontend-runtime-config/spec.md)
**Origin**: archived OpenSpec change [`2026-05-16-adopt-runtime-config-for-frontend`](https://github.com/liverty-music/specification/tree/main/openspec/changes/archive/2026-05-16-adopt-runtime-config-for-frontend)

---

## TL;DR

Per-environment values (API URL, OIDC IDs, VAPID key, log level, preview artist data) come from a `/config.json` fetched at bootstrap, **not** from `import.meta.env.VITE_*`. The container image is env-agnostic; per-env divergence lives in a Kubernetes ConfigMap under `cloud-provisioning/k8s/namespaces/frontend/overlays/<env>/`.

```
┌─────────────┐   fetch    ┌──────────────────┐  reads   ┌────────────────────────────┐
│ main.ts     │ ────────▶  │ /config.json     │ ◀──────  │ ConfigMap (per env overlay)│
│ bootstrap() │            │ (served by Caddy │  K8s     │ web-app-runtime-config     │
│             │            │  from /srv/)     │  mount   │                            │
└─────────────┘            └──────────────────┘          └────────────────────────────┘
       │
       ▼
   loadAppConfig() → validate → validateEnvironmentMatchesHost() → register IAppConfig → Aurelia.start()
```

---

## Bootstrap order

[`src/main.ts`](../src/main.ts) defines an async `bootstrap()` that runs **before** `Aurelia.start()`:

1. `await loadAppConfig()` — fetches `/config.json` with `AbortSignal.timeout(5000)`, parses JSON, validates the schema field-by-field. Throws naming the offending field on missing/empty/invalid values.
2. `validateEnvironmentMatchesHost(config)` — if the page is loaded at a well-known production-tier hostname (see [`src/config/known-hosts.ts`](../src/config/known-hosts.ts)), refuses to start unless `config.environment` agrees. Catches "wrong ConfigMap mounted in prod cluster" silently serving dev values.
3. `initOtel(config.apiBaseUrl)` — OTel trace propagation needs to know which host is the backend.
4. `new Aurelia()` + `au.register(Registration.instance(IAppConfig, config))` — register the resolved config **first** so every later `resolve(IAppConfig)` succeeds.
5. Register all other services + components.
6. `au.app(AppShell).start()` — Aurelia renders, the inline `Loading…` indicator is removed.

On any failure between (1) and (6), `bootstrap().catch(showStaticErrorPage)` replaces `document.body` with a minimal static error block (no Aurelia primitive required).

---

## Two sources of `/config.json`, by deploy target

| Where the SPA runs | What it reads at `/config.json` |
|---|---|
| `npm start` (Vite dev server, local) | [`public/config.json`](../public/config.json) — served by Vite from the public dir |
| Storybook, local Playwright | Same as above |
| Inside a K8s pod (dev / staging / prod) | The image's `public/config.json` is **shadowed** by a `subPath` mount of `web-app-runtime-config` ConfigMap at `/srv/config.json`. Caddy serves the mounted file |

**The container image is identical across environments.** The bundled `public/config.json` exists only so `npm start` works out-of-the-box and as a loud-failure beacon: if a non-dev cluster's mount goes missing, `validateEnvironmentMatchesHost` refuses to start (dev values served from a prod host → throw).

---

## Adding a new env-divergent field

Follow these steps in order — they're listed so the build / boot validators catch a miss at the next CI run rather than at deploy time.

### 1. `src/config/app-config.ts`

Add the field to `AppConfig`:

```ts
export interface AppConfig {
  // ...existing fields...
  readonly myNewField: string
}
```

Add a validator entry to `validateAppConfig()` (use `requireString` for required-non-empty, `optionalString` for present-but-MAY-be-empty, `requireStringArray` for arrays). If the type is constrained, add an enum-style check after extraction.

Add a unit test in [`src/config/app-config.spec.ts`](../src/config/app-config.spec.ts) — the `it.each` table at the top covers "throws when required field X is missing"; add `'myNewField'` to that list.

### 2. `public/config.json`

Add the dev value for the new field. This unblocks `npm start` + Storybook + local Playwright.

### 3. Every overlay's `configmap.yaml`

In **all** of:

- `cloud-provisioning/k8s/namespaces/frontend/overlays/dev/configmap.yaml`
- `cloud-provisioning/k8s/namespaces/frontend/overlays/prod/configmap.yaml`
- *(staging overlay if/when it exists)*

…add the field with the env-appropriate value. **Missing values in any overlay fail loud at boot** because `loadAppConfig`'s schema validator throws on first missing required field. CI does not catch this — the live deploy does.

### 4. Migration

ConfigMap edits land via the normal cloud-provisioning GitOps flow. The `reloader.stakater.com/auto: "true"` annotation on the frontend Deployment triggers a rolling restart when the ConfigMap changes. Order of merges: cloud-provisioning ConfigMap edit **before** the frontend code that reads the new field (so the field exists when the new image first boots).

---

## Service Worker behavior

[`src/sw.ts`](../src/sw.ts) installs a `NetworkOnly` route for `/config.json`:

```ts
registerRoute(({ url }) => url.pathname === '/config.json', new NetworkOnly())
```

- **Why NetworkOnly**: ConfigMap updates (followed by pod rollout via Reloader) MUST propagate on the next page load without depending on URL cache-busting. A cached `/config.json` would let the SPA boot against stale config after an operator change.
- **Trade-off**: a user offline after a previous successful load will see `showStaticErrorPage`, not a partial cached experience. Auth and gRPC already require network, so offline support was always limited. **Explicit non-goal for this iteration** — see the archived change's design D6.
- **`/config.json` is intentionally NOT in `__WB_MANIFEST`** (Workbox precache). It's mounted at deploy time, not shipped in `dist/` beyond the public fallback.

If offline-tolerant config becomes a goal later, swap `NetworkOnly` for `NetworkFirst` with a short TTL — additive change, no spec contract revision needed.

---

## Adding a new route

The route also needs to be registered in **two** places, plus one defense-in-depth gate:

### 1. `src/app-shell.ts`

Add an entry to the `@route({ routes: [...] })` decorator:

```ts
{
  path: 'my-new-route',
  component: import('./routes/my-new-route/my-new-route'),
  title: 'My New Route',
  data: { auth: false }, // or omit for auth-required
},
```

### 2. `scripts/verify-build-templates.lib.ts`

Add a marker entry to `ROUTE_MARKERS`:

```ts
{ route: 'my-new-route', marker: 'my-new-route-hero' },
```

The marker must be a **stable class name or data-attribute string that appears in the route's compiled `.html`** but NOT in its `.ts` file. This is what proves the HTML template survived compilation into the lazy chunk. Failure to add this entry means the route silently escapes the build-time template-presence gate that protects against the v1.0.0 blank-screen regression class (`@aurelia/vite-plugin`'s literal `mode === 'production'` template-stripping bug).

The contract test in [`scripts/verify-build-templates.spec.ts`](../scripts/verify-build-templates.spec.ts) asserts route and marker uniqueness within `ROUTE_MARKERS` but does **not** parse `app-shell.ts` to verify both sides are aligned. Keeping them in sync is a manual step.

### 3. Run locally to verify

```bash
npm run build
npm run verify:build-templates   # asserts every route chunk contains its marker
npm run test:scripts             # tests the ROUTE_MARKERS shape contract
```

The Dockerfile runs `npm run verify:build-templates` as a hard gate, so a CI build fails fast on a missing marker.

---

## CSP compatibility

[`index.html`](../index.html) declares the CSP via `<meta http-equiv="Content-Security-Policy">`:

```
connect-src 'self' https://*.zitadel.cloud https://*.liverty-music.app;
frame-src   https://*.zitadel.cloud;
```

The `*.liverty-music.app` wildcard covers `api.dev.`, `api.`, `auth.dev.`, `auth.` — i.e. all current envs share the same CSP without per-env rewriting. This is intentional and is part of why the env-agnostic image works without a Caddy template plugin. Tightening to per-env hostnames would require either:

- A Caddy template/envsubst step at container startup (sourced from the ConfigMap), **or**
- A new spec change for runtime CSP injection.

Out of scope for the runtime-config capability.

---

## Smoke verification

| Layer | What | Where |
|---|---|---|
| Unit | Schema validator, host cross-check | [`src/config/app-config.spec.ts`](../src/config/app-config.spec.ts) |
| Build-time gate | Every route chunk contains its template marker | `npm run verify:build-templates` (Dockerfile + CI) |
| Post-deploy | SPA renders + `/config.json` env field matches host | `npm run test:smoke` (auto on push-to-main via `Deploy Frontend` workflow's `post-deploy-smoke` job; manual via `workflow_dispatch` for prod after the automated cloud-provisioning pin-bump lands on `main`) |

---

## Pointers

- **Spec**: `frontend-runtime-config` capability (linked at top).
- **Bootstrap code**: [`src/main.ts`](../src/main.ts), [`src/config/app-config.ts`](../src/config/app-config.ts), [`src/config/known-hosts.ts`](../src/config/known-hosts.ts).
- **Cluster overlays**: `cloud-provisioning/k8s/namespaces/frontend/overlays/<env>/configmap.yaml`.
- **Deploy workflow**: [`.github/workflows/push-image.yaml`](../.github/workflows/push-image.yaml).
- **Defense-in-depth**: [`scripts/verify-build-templates.lib.ts`](../scripts/verify-build-templates.lib.ts), [`scripts/verify-build-templates.spec.ts`](../scripts/verify-build-templates.spec.ts).
- **Smoke spec**: [`e2e/smoke/post-deploy.spec.ts`](../e2e/smoke/post-deploy.spec.ts), [`playwright.smoke.config.mjs`](../playwright.smoke.config.mjs).
