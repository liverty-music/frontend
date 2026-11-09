import { test as base } from '@playwright/test'
import { installAuthMocks } from './auth-mocks'
import { blockWebFonts, layoutDir, recordLayout } from './layout-record'

/**
 * Shared Playwright `test` with the OIDC discovery endpoints auto-stubbed, so
 * specs never depend on a live auth server (the dev environment can be
 * intentionally offline). Import `{ test, expect }` from this module instead of
 * `@playwright/test` for any spec that boots the app.
 *
 * Only the auth dependency is centralized here; specs keep seeding their own
 * fake OIDC user and RPC/Last.fm responses.
 *
 * With `LAYOUT_DIR` set, each passing test also records its final layout
 * (`layout-record.ts`).
 */
export const test = base.extend({
	page: async ({ page }, use, testInfo) => {
		await installAuthMocks(page)
		if (layoutDir) await blockWebFonts(page)
		await use(page)
		if (layoutDir && testInfo.status === 'passed' && !page.isClosed()) {
			await recordLayout(page, testInfo, layoutDir)
		}
	},
})

export type {
	BrowserContext,
	Locator,
	Page,
	Request,
	Route,
} from '@playwright/test'
export { expect } from '@playwright/test'
