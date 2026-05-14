/**
 * Captures an authenticated Playwright session via the dev self-hosted
 * Zitadel password flow.
 *
 * Headless. No display server required. Suitable for WSL2 + WSLg hosts
 * where `capture-auth-state.ts` (headed Chromium) cannot render the
 * Chromium window reliably.
 *
 * Usage:
 *
 *   npm run auth:capture:password
 *
 * Prerequisites:
 *
 *   - The frontend dev server must be running: `npm start`
 *   - The password test user has been provisioned via Pulumi
 *     (`cloud-provisioning` change `playwright-password-test-user`).
 *   - The test user's password is present either at `.auth/password.md`
 *     (preferred — mirror of the ESC secret) or in `E2E_PASSWORD`.
 *
 * See `.auth/README.md` for the first-time setup procedure and the
 * ESC retrieval command.
 *
 * Output:
 *
 *   `.auth/storageState.json` (gitignored).
 *
 * The script exits non-zero if any step fails — it never produces a
 * silently-broken storageState. The Playwright `authenticated` and
 * `authenticated-visual` projects in `playwright.config.mjs` consume
 * this file automatically.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from '@playwright/test'

const APP_URL = process.env.APP_URL || 'http://localhost:9000'
const OUTPUT_DIR = path.join(import.meta.dirname, '..', '.auth')
const STORAGE_STATE_PATH = path.join(OUTPUT_DIR, 'storageState.json')
const PASSWORD_PATH = path.join(OUTPUT_DIR, 'password.md')
const DEFAULT_USERNAME = 'e2e-test-password@dev.liverty-music.app'

function loadPassword(): string {
	const envPassword = process.env.E2E_PASSWORD
	if (envPassword) {
		return envPassword
	}
	if (!fs.existsSync(PASSWORD_PATH)) {
		console.error(`[error] Password file not found: ${PASSWORD_PATH}`)
		console.error('Either set E2E_PASSWORD or create .auth/password.md.')
		console.error('See .auth/README.md "First-time setup" for the ESC command.')
		process.exit(1)
	}
	const contents = fs.readFileSync(PASSWORD_PATH, 'utf-8').trim()
	if (contents.length === 0) {
		console.error(`[error] Password file is empty: ${PASSWORD_PATH}`)
		process.exit(1)
	}
	return contents
}

async function captureAuthStatePassword(): Promise<void> {
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })

	const username = process.env.E2E_USERNAME || DEFAULT_USERNAME
	const password = loadPassword()

	const browser = await chromium.launch({ headless: true })

	try {
		const context = await browser.newContext()
		const page = await context.newPage()
		page.setDefaultTimeout(60_000)

		console.log(`[1/5] Navigating to ${APP_URL}…`)
		await page.goto(APP_URL)

		console.log('[2/5] Clicking welcome page Login CTA to start OIDC sign-in…')
		// The welcome page does NOT auto-redirect to Zitadel — OIDC sign-in
		// is only initiated by clicking the Login button wired to
		// `handleLogin()` in `src/routes/welcome/welcome-route.ts`. The
		// button has class `welcome-btn-secondary` (the welcome HTML
		// renders one of two button groups depending on `dateGroups.length`;
		// `.first()` picks whichever is visible).
		const loginButton = page.locator('button.welcome-btn-secondary').first()
		await loginButton.waitFor({ state: 'visible' })
		await loginButton.click()
		// Wait for the cross-origin navigation to the Zitadel auth server.
		// `waitForURL` matches against the full URL; the regex tolerates
		// any path under the auth host.
		await page.waitForURL(/auth\.dev\.liverty-music\.app/, { timeout: 30_000 })

		console.log('[3/5] Submitting username…')
		// Zitadel Login V2 — username input. The locator tolerates either
		// the explicit `loginName` field name or a generic text input as a
		// resilience hedge against upstream markup tweaks.
		const usernameInput = page
			.locator('input[name="loginName"], input[autocomplete="username"], input[type="text"]')
			.first()
		await usernameInput.waitFor({ state: 'visible' })
		await usernameInput.fill(username)
		await page
			.locator('button[type="submit"]')
			.first()
			.click()

		console.log('[4/5] Submitting password…')
		const passwordInput = page
			.locator('input[type="password"], input[name="password"]')
			.first()
		await passwordInput.waitFor({ state: 'visible' })
		await passwordInput.fill(password)
		await page.locator('button[type="submit"]').first().click()

		console.log('[5/5] Waiting for OIDC callback to complete…')
		await page.waitForFunction(
			() => {
				try {
					const localKeys = Object.keys(localStorage)
					const sessionKeys = Object.keys(sessionStorage)
					return Boolean(
						localKeys.find((key) => key.startsWith('oidc.user:')) ||
							sessionKeys.find((key) => key.startsWith('oidc.user:')),
					)
				} catch {
					// Some intermediate pages (Zitadel Login V2, about:blank during
					// redirects) throw SecurityError when reading storage. Treat as
					// "not yet authenticated" and keep polling.
					return false
				}
			},
			{ polling: 500, timeout: 60_000 },
		)

		// Write to a temp path first; promote atomically only after the
		// smoke test confirms the captured state actually authenticates.
		// Without this, a failed smoke test would silently destroy the
		// previously-working `storageState.json` (we write before we verify).
		const tempStatePath = `${STORAGE_STATE_PATH}.tmp`
		await context.storageState({ path: tempStatePath })
		await context.close()

		console.log('Smoke test: replaying captured state on a fresh context…')
		const smokeContext = await browser.newContext({
			storageState: tempStatePath,
		})
		const smokePage = await smokeContext.newPage()
		smokePage.setDefaultTimeout(15_000)

		// Navigate to a protected route. Authenticated traffic lands on
		// `/dashboard`; unauthenticated traffic gets redirected by
		// `AuthHook` (priority 5 returns '') → root route's
		// `redirectTo: 'welcome'` → `/welcome`. Use a POSITIVE check
		// (must land on the requested protected route) rather than
		// enumerating redirect targets — the check is robust even when
		// the unauthenticated landing path changes.
		await smokePage.goto(`${APP_URL}/dashboard`)
		await smokePage.waitForLoadState('networkidle')
		const finalUrl = smokePage.url()
		await smokeContext.close()

		if (!finalUrl.startsWith(`${APP_URL}/dashboard`)) {
			console.error(
				`[error] Smoke test FAILED: protected route redirected away from /dashboard (landed at ${finalUrl}).`,
			)
			console.error('The captured storageState does not authenticate the user.')
			console.error('Likely causes: wrong password, expired ESC value, or test user not provisioned.')
			// Leave the previously-working storageState.json (if any) intact.
			try {
				fs.unlinkSync(tempStatePath)
			} catch {
				// nothing to clean up
			}
			process.exit(2)
		}

		// Smoke passed — atomically promote the temp file to the final path.
		fs.renameSync(tempStatePath, STORAGE_STATE_PATH)
		console.log(`Storage state saved to ${STORAGE_STATE_PATH}`)
		console.log(`Smoke test PASSED: ${finalUrl}`)
	} finally {
		await browser.close()
	}
}

captureAuthStatePassword().catch((err) => {
	console.error('Failed to capture auth state:', err)
	process.exit(1)
})
