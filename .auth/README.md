# `.auth/` — Playwright E2E authentication state

This directory holds credentials and captured browser state for Playwright E2E tests against the dev self-hosted Zitadel instance (`https://auth.dev.liverty-music.app`).

> **Everything in `.auth/` is gitignored except this README.** Credential files (`password.md`) and captured storage state (`storageState.json`) are generated locally by each developer and never committed.

---

## Test user

The dev Zitadel hosts a single Pulumi-managed E2E test user:

| User | Auth | Capture command |
|---|---|---|
| `e2e-test-password@dev.liverty-music.app` | Username + password | `npm run auth:capture:password` |

Provisioned by `cloud-provisioning/src/zitadel/components/e2e-test-user.ts` (OpenSpec change `playwright-password-test-user`, archived 2026-05-14). The script runs **headless** against `https://auth.dev.liverty-music.app` — no display server required, works on macOS / Linux / WSL2 + WSLg / CI runners.

---

## First-time setup

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
[1/5] Navigating to http://localhost:9000…
[2/5] Clicking welcome page Login CTA to start OIDC sign-in…
[3/5] Submitting username…
[4/5] Submitting password…
[5/5] Waiting for OIDC callback to complete…
Storage state saved to .auth/storageState.json
Smoke test: replaying storage state on a fresh context…
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

## File reference

| File | Gitignored | Purpose |
|---|---|---|
| `.auth/README.md` | NO (exempted) | This document |
| `.auth/password.md` | YES | Test user password (manual mirror of ESC) |
| `.auth/storageState.json` | YES | Captured Playwright session (regenerate on demand) |
| `scripts/capture-auth-state-password.ts` | NO | Headless password-flow capture script |

---

## Historical note

Earlier revisions of this project documented a second, passkey-based capture path against `pepperoni9+playwright-1@gmail.com` via `scripts/capture-auth-state.ts`. That user was a Zitadel-Cloud-era Self-Registration account that was wiped by `self-hosted-zitadel §10`'s `truncate_users_for_zitadel_migration` migration and was never re-provisioned on self-hosted dev Zitadel. The script was removed by OpenSpec change `remove-passkey-capture-path`. If a future need for WebAuthn / passkey CI regression testing surfaces, the design should use Chrome DevTools virtual authenticator (`webAuthn.addVirtualAuthenticator`) — not a fork of the deleted script's lineage.
