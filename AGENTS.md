<poly-repo-context repo="frontend">
  <responsibilities>Aurelia 2 single-page PWA for music fans. Vite build, CUBE CSS methodology,
  Biome linter, Zitadel OIDC auth, Vitest + Playwright testing.</responsibilities>
  <essential-commands>
    make lint              # Biome lint + format check + stylelint + typecheck + brand-vocabulary (matches CI)
    make fix               # Auto-fix formatting (biome check --write)
    make test              # Unit tests with coverage (vitest)
    make check             # Full pre-commit check (lint + test)
    npm start              # Dev server
    npm run build          # Production build
    npx playwright test    # E2E tests
  </essential-commands>
</poly-repo-context>

<agent-rules>

## Stack

| Stack            | Technology                                           |
|------------------|------------------------------------------------------|
| **Framework**    | Aurelia 2 (`aurelia`, `@aurelia/router`)              |
| **Build**        | Vite (`@aurelia/vite-plugin`)                         |
| **Styling**      | CUBE CSS methodology (`@layer`, `@scope`)             |
| **Linter**       | Biome (`@biomejs/biome`)                              |
| **Auth**         | Zitadel via `oidc-client-ts`                          |
| **Testing**      | Vitest + `@aurelia/testing`, Playwright (E2E)         |
| **Stories**      | Storybook (`@aurelia/storybook`)                      |

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

## Playwright MCP (Authenticated E2E Testing)

All routes require authentication by default (`AuthHook` in `src/hooks/auth-hook.ts`). Public routes explicitly set `data: { auth: false }` in route config.

Two dev test users exist; pick the capture path that matches your host:

| Test user | Auth | Capture command | Suitable host |
|---|---|---|---|
| `e2e-test-password@dev.liverty-music.app` | Username + password | `npm run auth:capture:password` | Any host including WSL2 + WSLg (default, headless) |
| `pepperoni9+playwright-1@gmail.com` | Passkey (WebAuthn) | `npx tsx scripts/capture-auth-state.ts` | macOS / Linux with working display + registered authenticator device |

Both write to `.auth/storageState.json` — the `playwright-auth` MCP server (configured in `.claude/settings.json`) consumes whichever was captured most recently.

**For the password flow** (preferred for WSL2 / CI / scripted automation):

1. Retrieve the password from ESC once and mirror it locally:
   ```bash
   esc env get liverty-music/dev pulumiConfig.zitadel.e2eTestUser.password --show-secrets
   # write the value into frontend/.auth/password.md (gitignored)
   ```
2. Start the dev server: `npm start`
3. Run: `npm run auth:capture:password`

The script is fully headless, drives the OIDC username/password flow, and self-verifies (atomic write — fails non-zero without destroying any prior working `storageState.json`). See [`frontend/.auth/README.md`](.auth/README.md) for the full setup, rotation protocol, and credential-file conventions.

**For the passkey flow** (manual smoke testing on display-capable hosts), use the legacy `capture-auth-state.ts`. It opens a headed Chromium window for the operator to complete the OIDC login with the passkey gesture. On WSL2 + WSLg this path is unreliable — the Chromium window often stays at `about:blank` past the 5-minute polling timeout; use the password flow above instead.

If navigation to a protected route redirects away from the requested page, the storageState has likely expired. Re-run the appropriate capture script.

## Key Technical Decisions

### 1. Canvas + Matter.js for Artist Discovery

The artist discovery bubble UI uses HTML5 Canvas 2D with Matter.js physics engine. This was chosen over DOM-based animation for performance with 30+ animated elements on mobile. See `src/components/dna-orb/`.

### 2. Direct Last.fm API Calls

Last.fm API is called directly from the frontend (client-side). The API key is public/read-only by design. Calls use 300ms debounce and in-memory caching.

### 3. DI + Service State Management

Application state (onboarding progress, guest artist data) is managed through singleton services with Aurelia's native DI and observation. `OnboardingService` and `GuestService` own their state as `@observable` properties, hydrate from localStorage on construction, and persist via explicit storage functions in `src/adapter/storage/`. No external state library is used — Aurelia's built-in observation system handles reactivity.

### 4. Onboarding Flow via OIDC Sign-Up Detection

New vs returning users are distinguished by the `isSignUp` flag in the OIDC state. The auth callback routes sign-up users to artist discovery and sign-in users directly to the dashboard.

</agent-rules>
