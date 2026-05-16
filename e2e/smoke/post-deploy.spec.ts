import { expect, test } from '@playwright/test'
import { KNOWN_HOSTS } from '../../src/config/app-config'

/**
 * Post-deploy smoke against a live (deployed) frontend URL. Asserts the
 * SPA renders to a non-empty DOM and that `/config.json` reports the
 * expected `environment` for that hostname. Catches blank-page
 * regressions (e.g., v1.0.0's missing template chunks) agnostic of root
 * cause.
 *
 * Drive with `SMOKE_BASE_URL` env var. Use the dedicated smoke config
 * (`playwright.smoke.config.mjs`) so this spec's project runs without
 * the local dev-server `webServer` block firing.
 */

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? ''

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
