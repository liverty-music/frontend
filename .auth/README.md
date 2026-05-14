# `.auth/` — Playwright E2E authentication state

This directory holds credentials and captured browser state for Playwright E2E tests against the dev self-hosted Zitadel instance (`https://auth.dev.liverty-music.app`).

> **Everything in `.auth/` is gitignored except this README.** Credential files (`password.md`) and captured storage state (`storageState.json`) are generated locally by each developer and never committed.

---

## Two test users, two capture paths

| User | UserName / email | Auth method | Capture script | Suitable host |
|---|---|---|---|---|
| Existing passkey user | `pepperoni9+playwright-1@gmail.com` | Passkey (WebAuthn) | `scripts/capture-auth-state.ts` (headed Chromium, manual gesture) | macOS / Linux with working display + registered authenticator device |
| **E2E password test user** (new) | `e2e-test-password@dev.liverty-music.app` | Username + password | `scripts/capture-auth-state-password.ts` (headless Chromium, scripted) | Any host including WSL2 + WSLg |

Both users are provisioned in the dev Zitadel instance and coexist. Neither replaces the other.

The password user was added to unblock headless / CI / WSL2 capture — passkey credentials require a biometric/PIN gesture from the registered device and cannot be replayed by headless Playwright. See OpenSpec change [`playwright-password-test-user`](../../specification/openspec/changes/) for the full design.

---

## First-time setup (password flow, default)

### 1. Retrieve the test user's password from ESC

The password is stored as a secret in Pulumi ESC under the dev environment. Retrieve it once:

```bash
esc env get liverty-music/dev pulumiConfig.zitadel.e2eTestUser.password --show-secrets
```

Output is a single string — the test user's password.

### 2. Write it to `.auth/password.md`

```bash
echo '<paste-the-password-here>' > .auth/password.md
```

The file's contents are read verbatim (whitespace trimmed). No markdown formatting required.

`.auth/password.md` is gitignored — never commit it.

### 3. Start the dev server

The capture script navigates to the local dev server (default: `http://localhost:9000`):

```bash
npm start
```

Leave it running.

### 4. Run the capture script

```bash
npm run auth:capture:password
```

Expected output:

```
[1/4] Navigating to http://localhost:9000...
[2/4] Submitting username...
[3/4] Submitting password...
[4/4] Waiting for OIDC callback to complete...
Storage state saved to .auth/storageState.json
Smoke test: replaying storage state on a fresh context...
Smoke test PASSED: protected route loaded (http://localhost:9000/dashboard).
```

The script writes `.auth/storageState.json` and exits 0 on success. On failure (wrong password, redirect to landing, etc.) it exits non-zero — never produces a silently-broken storage state.

### 5. Run E2E

```bash
npx playwright test
```

The `authenticated` and `authenticated-visual` Playwright projects (see `playwright.config.mjs`) consume `.auth/storageState.json` automatically.

---

## Rotating the password

If the ESC secret is rotated (or the user changes the `--secret` value), Pulumi WILL NOT replace the HumanUser automatically — the resource has `ignoreChanges: ['initialPassword']` to prevent silent token invalidation. Intentional rotation:

1. Set the new ESC value: `esc env set liverty-music/dev pulumiConfig.zitadel.e2eTestUser.password <new> --secret`
2. Trigger Pulumi up with explicit replace: `pulumi up --replace 'urn:pulumi:dev::liverty-music::...:E2eTestUser$zitadel:index/humanUser:HumanUser::e2e-test-password'`
3. Update `.auth/password.md` with the new value
4. Re-run `npm run auth:capture:password`

---

## When the storage state expires

Zitadel access tokens have a finite TTL. After expiry, `npx playwright test` will start failing with 401 / redirects to landing. Just re-run the capture script:

```bash
npm run auth:capture:password
```

No need to refresh `.auth/password.md` — the password itself hasn't rotated.

---

## Falling back to the passkey flow (manual smoke testing)

The passkey path is retained for hosts with a working display and registered authenticator. Use the existing script:

```bash
npx tsx scripts/capture-auth-state.ts
```

This opens a headed Chromium window; complete the OIDC login flow with the passkey user manually. The script waits up to 5 minutes for the `oidc.user:*` key to appear in storage, then writes `.auth/storageState.json`.

**WSL2 + WSLg note**: this path is currently unreliable on WSL2 — the Chromium window opens but the page often stays at `about:blank` past the 5-minute polling timeout. Use the password flow above instead.

---

## File reference

| File | Gitignored | Purpose |
|---|---|---|
| `.auth/README.md` | NO (exempted) | This document |
| `.auth/password.md` | YES | Test user password (manual mirror of ESC) |
| `.auth/storageState.json` | YES | Captured Playwright session (regenerate on demand) |
| `scripts/capture-auth-state-password.ts` | NO | Password-flow headless capture script |
| `scripts/capture-auth-state.ts` | NO | Passkey-flow headed capture script (legacy) |
