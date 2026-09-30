---
name: e2e-auth
description: Authenticated E2E testing via the playwright-auth MCP server - the dev Zitadel test user, retrieving its password from ESC, capturing .auth/storageState.json, and recovering from an expired session. Use when driving protected routes in Playwright or when storageState needs to be (re)captured.
---

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
