import { test as base } from '@playwright/test'
import { installAuthMocks } from './auth-mocks'

/**
 * Shared Playwright `test` with the OIDC discovery endpoints auto-stubbed, so
 * specs never depend on a live auth server (the dev environment can be
 * intentionally offline). Import `{ test, expect }` from this module instead of
 * `@playwright/test` for any spec that boots the app.
 *
 * Only the auth dependency is centralized here; specs keep seeding their own
 * fake OIDC user and RPC/Last.fm responses.
 */
export const test = base.extend({
	page: async ({ page }, use) => {
		await installAuthMocks(page)
		await use(page)
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
