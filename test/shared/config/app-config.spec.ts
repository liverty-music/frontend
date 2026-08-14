import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	__resetAppConfigForTests,
	loadAppConfig,
} from '../../../shared/config/app-config'

/**
 * Focused coverage for the `requireOrgId` contract added by OpenSpec change
 * `organizer-console`: the consumer SPA and admin console require a fixed
 * `zitadelOrgId`, while the organizer console (which pins the tenant per
 * session by org-pinned entry) loads with `requireOrgId: false` and tolerates
 * its absence.
 */
const BASE_CONFIG = {
	environment: 'dev',
	apiBaseUrl: 'https://api.test.local',
	zitadelIssuer: 'https://auth.test.local',
	zitadelClientId: 'client-123',
	vapidPublicKey: 'vapid-123',
	previewArtistIds: [],
	previewArtistNames: [],
	logLevel: 'warn',
}

function mockConfigFetch(body: Record<string, unknown>): void {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => body,
		}),
	)
}

describe('loadAppConfig — zitadelOrgId requirement', () => {
	beforeEach(() => {
		__resetAppConfigForTests()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		__resetAppConfigForTests()
	})

	it('rejects a config missing zitadelOrgId by default (consumer/admin contract)', async () => {
		mockConfigFetch(BASE_CONFIG)
		await expect(loadAppConfig()).rejects.toThrow(/zitadelOrgId/)
	})

	it('accepts a config missing zitadelOrgId when requireOrgId is false (organizer)', async () => {
		mockConfigFetch(BASE_CONFIG)
		const config = await loadAppConfig({ requireOrgId: false })
		expect(config.zitadelOrgId).toBeUndefined()
		expect(config.zitadelClientId).toBe('client-123')
	})

	it('preserves a present zitadelOrgId even when it is not required', async () => {
		mockConfigFetch({ ...BASE_CONFIG, zitadelOrgId: 'org-abc' })
		const config = await loadAppConfig({ requireOrgId: false })
		expect(config.zitadelOrgId).toBe('org-abc')
	})
})
