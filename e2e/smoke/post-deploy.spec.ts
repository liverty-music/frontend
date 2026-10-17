import { expect, test } from '@playwright/test'
import { KNOWN_HOSTS } from '../../src/config/known-hosts'
import {
	expectLayerOrderDeclaredFirst,
	expectOwnStyles,
} from '../support/rendered-styles'

/**
 * Post-deploy smoke against a live (deployed) frontend URL. Asserts the
 * SPA renders to a non-empty DOM and that `/config.json` reports the
 * expected `environment` for that hostname. Catches blank-page
 * regressions (e.g., v1.0.0's missing template chunks) agnostic of root
 * cause.
 *
 * Both the fan welcome page and the organizer entry must render with their
 * component styles applied (a build that loses them, like v1.89.0, still
 * renders a non-empty DOM).
 *
 * Drive with `SMOKE_BASE_URL` env var; `SMOKE_ORGANIZER_URL` adds the
 * organizer entry. Use the dedicated smoke config
 * (`playwright.smoke.config.mjs`) so this spec's project runs without
 * the local dev-server `webServer` block firing.
 */

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? ''
const SMOKE_ORGANIZER_URL = process.env.SMOKE_ORGANIZER_URL ?? ''

test.describe('post-deploy smoke', () => {
	test.skip(!SMOKE_BASE_URL, 'SMOKE_BASE_URL is required for post-deploy smoke')

	// Wall-clock bound per frontend-hosting spec "Post-deploy smoke
	// verification" requirement: a hanging deploy must fail closed.
	test.setTimeout(60_000)

	test('homepage renders non-empty DOM and welcome first-screen is present', async ({
		page,
	}) => {
		const url = new URL('/', SMOKE_BASE_URL).toString()
		await page.goto(url, { waitUntil: 'networkidle' })

		const bodyText = (await page.locator('body').innerText()).trim()
		expect(
			bodyText.length,
			`Body innerText is empty at ${url} — SPA failed to render. Likely a route resolution or bootstrap failure.`,
		).toBeGreaterThan(0)

		// Welcome route's first-screen marker (also used by verify-build-templates).
		await expect(page.locator('.welcome-brand').first()).toBeVisible({
			timeout: 10_000,
		})

		await expectLayerOrderDeclaredFirst(page)
		// With preview data the hero offers the scroll button, without it the
		// sign-up button; either carries padding from its own block styles.
		await expectOwnStyles(
			page
				.locator(
					'[data-testid="welcome-see-preview"], [data-testid="welcome-get-started"]',
				)
				.first(),
			"the welcome page's call to action",
			{ padding: true },
		)
	})

	test('organizer entry renders with its component styles', async ({
		page,
		request,
	}) => {
		test.skip(!SMOKE_ORGANIZER_URL, 'SMOKE_ORGANIZER_URL is not set')

		// A signed-out visitor is sent to sign-in, so nothing of the console
		// renders. The denied page renders for any session without asking the
		// API; a made-up session is seeded in this browser only, and the API
		// never sees it.
		const configUrl = new URL('/config.json', SMOKE_ORGANIZER_URL).toString()
		const config = (await (await request.get(configUrl)).json()) as {
			zitadelIssuer: string
			zitadelClientId: string
		}
		await page.addInitScript((key) => {
			localStorage.setItem(
				key,
				JSON.stringify({
					id_token: 'smoke-id-token',
					access_token: 'smoke-access-token',
					token_type: 'Bearer',
					scope: 'openid',
					profile: { sub: 'post-deploy-smoke' },
					expires_at: 9999999999,
				}),
			)
		}, `oidc.user:${config.zitadelIssuer}:${config.zitadelClientId}`)

		await page.goto(new URL('/denied', SMOKE_ORGANIZER_URL).toString())
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

		await expectLayerOrderDeclaredFirst(page)
		await expectOwnStyles(
			page.locator('console-button [data-variant="filled"]'),
			"the denied page's sign-out button",
			{ padding: true, background: true },
		)
	})

	test('/config.json returns the expected environment for this host', async ({
		request,
	}) => {
		const configUrl = new URL('/config.json', SMOKE_BASE_URL).toString()
		const res = await request.get(configUrl)
		expect(res.status(), `GET ${configUrl}`).toBe(200)

		const config = (await res.json()) as { environment?: unknown }
		expect(
			typeof config.environment,
			'config.json must include a string `environment` field',
		).toBe('string')

		const hostname = new URL(SMOKE_BASE_URL).hostname
		const expected = KNOWN_HOSTS[hostname]
		if (expected) {
			expect(
				config.environment,
				`host ${hostname} should serve environment '${expected}', got '${config.environment as string}'`,
			).toBe(expected)
		}
	})
})
