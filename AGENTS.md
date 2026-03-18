<poly-repo-context repo="frontend">
  <responsibilities>Aurelia 2 single-page PWA for music fans. Vite build, CUBE CSS methodology,
  Biome linter, Zitadel OIDC auth, Vitest + Playwright testing.</responsibilities>
  <essential-commands>
    make lint              # Biome lint + format check + stylelint + typecheck (matches CI)
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

Test user: `pepperoni9+playwright-1@gmail.com` (password in `.auth/password.md`).

Before using the `playwright-auth` MCP server to test protected routes:

```bash
npx tsx scripts/capture-auth-state.ts
```

This opens a browser for manual OIDC login and saves the session to `.auth/storageState.json`. The `playwright-auth` MCP server (configured in `.claude/settings.json`) uses this file automatically.

If navigation to a protected route redirects to `/`, the storageState has likely expired. Re-run the capture script.

On WSL2, the headed browser may not render via WSLg. Alternative: use Playwright MCP (headless) to navigate to `http://localhost:9000`, complete the login flow, extract localStorage, and write to `.auth/storageState.json`.

## Key Technical Decisions

### 1. Canvas + Matter.js for Artist Discovery

The artist discovery bubble UI uses HTML5 Canvas 2D with Matter.js physics engine. This was chosen over DOM-based animation for performance with 30+ animated elements on mobile. See `src/components/dna-orb/`.

### 2. Direct Last.fm API Calls

Last.fm API is called directly from the frontend (client-side). The API key is public/read-only by design. Calls use 300ms debounce and in-memory caching.

### 3. Centralised Store via `@aurelia/state`

Application state (onboarding progress, guest artist data) is managed through `@aurelia/state`, a Redux-style store integrated with Aurelia's DI. Singleton services act as thin facades over the store, dispatching actions and reading state. See `src/state/` for actions, reducer, and middleware.

### 4. Onboarding Flow via OIDC Sign-Up Detection

New vs returning users are distinguished by the `isSignUp` flag in the OIDC state. The auth callback routes sign-up users to artist discovery and sign-in users directly to the dashboard.

</agent-rules>
