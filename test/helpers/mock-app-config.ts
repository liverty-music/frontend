import type { AppConfig } from '../../src/config/app-config'

/**
 * Returns a fully populated dev-shaped AppConfig for unit tests. Override
 * specific fields by spreading: `createMockAppConfig({ environment: 'prod' })`.
 */
export function createMockAppConfig(overrides?: Partial<AppConfig>): AppConfig {
	return {
		environment: 'dev',
		apiBaseUrl: 'https://api.test.local',
		zitadelIssuer: 'https://auth.test.local',
		zitadelClientId: 'test-client-id',
		zitadelOrgId: 'test-org-id',
		vapidPublicKey: 'BNg-test-vapid-key',
		circuitBaseUrl: '/circuits/test',
		previewArtistIds: [],
		previewArtistNames: [],
		logLevel: 'warn',
		internalTrafficUserIds: [],
		...overrides,
	}
}
