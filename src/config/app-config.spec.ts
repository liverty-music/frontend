import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	__resetAppConfigForTests,
	type AppConfig,
	getAppConfig,
	loadAppConfig,
	validateEnvironmentMatchesHost,
} from './app-config'

const validConfig: AppConfig = {
	environment: 'dev',
	apiBaseUrl: 'https://api.dev.liverty-music.app',
	zitadelIssuer: 'https://auth.dev.liverty-music.app',
	zitadelClientId: '371355407710421859',
	zitadelOrgId: '371348346264093539',
	vapidPublicKey: 'BNg-test-key',
	circuitBaseUrl: '/circuits/ticketcheck-v1',
	previewArtistIds: ['019c8655-7a05-71ef-82b4-a4ac2494e29f'],
	previewArtistNames: ['Mrs. GREEN APPLE'],
	logLevel: 'debug',
	internalTrafficUserIds: [],
}

function mockFetchJson(body: unknown, ok = true, status = 200): void {
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok,
		status,
		statusText: ok ? 'OK' : 'Not Found',
		json: vi.fn().mockResolvedValue(body),
	}) as typeof globalThis.fetch
}

function mockFetchError(err: Error): void {
	globalThis.fetch = vi.fn().mockRejectedValue(err) as typeof globalThis.fetch
}

describe('app-config', () => {
	beforeEach(() => {
		__resetAppConfigForTests()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('loadAppConfig', () => {
		it('resolves a valid config and caches it', async () => {
			mockFetchJson(validConfig)
			const result = await loadAppConfig()
			expect(result.environment).toBe('dev')
			expect(result.apiBaseUrl).toBe('https://api.dev.liverty-music.app')
			expect(getAppConfig()).toBe(result)
		})

		it('throws when fetch returns non-2xx', async () => {
			mockFetchJson({}, false, 404)
			await expect(loadAppConfig()).rejects.toThrow(/HTTP 404/)
		})

		it('throws when fetch rejects', async () => {
			mockFetchError(new Error('network down'))
			await expect(loadAppConfig()).rejects.toThrow(/network down/)
		})

		it('throws when JSON parsing fails', async () => {
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: vi.fn().mockRejectedValue(new Error('unexpected token')),
			}) as typeof globalThis.fetch
			await expect(loadAppConfig()).rejects.toThrow(/parse failed/)
		})

		it('throws when top-level value is not a JSON object', async () => {
			mockFetchJson([])
			await expect(loadAppConfig()).rejects.toThrow(/JSON object/)
		})

		it.each([
			'environment',
			'apiBaseUrl',
			'zitadelIssuer',
			'zitadelClientId',
			'zitadelOrgId',
			'vapidPublicKey',
			'logLevel',
		])('throws when required field %s is missing', async (field) => {
			const partial = { ...validConfig } as Record<string, unknown>
			delete partial[field]
			mockFetchJson(partial)
			await expect(loadAppConfig()).rejects.toThrow(
				new RegExp(`missing or empty required field: ${field}`),
			)
		})

		it('throws on invalid environment value', async () => {
			mockFetchJson({ ...validConfig, environment: 'qa' })
			await expect(loadAppConfig()).rejects.toThrow(
				/environment must be one of/,
			)
		})

		it('throws on invalid logLevel value', async () => {
			mockFetchJson({ ...validConfig, logLevel: 'verbose' })
			await expect(loadAppConfig()).rejects.toThrow(/logLevel must be one of/)
		})

		it('throws when preview ID and name arrays differ in length', async () => {
			mockFetchJson({
				...validConfig,
				previewArtistIds: ['a', 'b'],
				previewArtistNames: ['x'],
			})
			await expect(loadAppConfig()).rejects.toThrow(/length mismatch/)
		})

		it('accepts empty circuitBaseUrl', async () => {
			mockFetchJson({ ...validConfig, circuitBaseUrl: '' })
			const result = await loadAppConfig()
			expect(result.circuitBaseUrl).toBe('')
		})

		it('defaults internalTrafficUserIds to an empty array when the field is absent', async () => {
			const partial = { ...validConfig } as Record<string, unknown>
			delete partial.internalTrafficUserIds
			mockFetchJson(partial)
			const result = await loadAppConfig()
			expect(result.internalTrafficUserIds).toEqual([])
		})

		it('passes through a populated internalTrafficUserIds allowlist', async () => {
			mockFetchJson({
				...validConfig,
				internalTrafficUserIds: ['staff-1', 'staff-2'],
			})
			const result = await loadAppConfig()
			expect(result.internalTrafficUserIds).toEqual(['staff-1', 'staff-2'])
		})

		it('throws when internalTrafficUserIds is present but not an array', async () => {
			mockFetchJson({ ...validConfig, internalTrafficUserIds: 'staff-1' })
			await expect(loadAppConfig()).rejects.toThrow(
				/internalTrafficUserIds.*must be an array/,
			)
		})

		it('throws when internalTrafficUserIds contains a non-string element', async () => {
			mockFetchJson({ ...validConfig, internalTrafficUserIds: ['staff-1', 42] })
			await expect(loadAppConfig()).rejects.toThrow(
				/internalTrafficUserIds.*non-string element/,
			)
		})
	})

	describe('getAppConfig', () => {
		it('throws before loadAppConfig completes', () => {
			expect(() => getAppConfig()).toThrow(
				/loadAppConfig\(\) must resolve before/,
			)
		})
	})

	describe('validateEnvironmentMatchesHost', () => {
		const originalLocation = window.location

		afterEach(() => {
			Object.defineProperty(window, 'location', {
				configurable: true,
				value: originalLocation,
			})
		})

		function setHostname(hostname: string): void {
			Object.defineProperty(window, 'location', {
				configurable: true,
				value: { ...originalLocation, hostname },
			})
		}

		it('passes when host and environment agree (prod)', () => {
			setHostname('liverty-music.app')
			expect(() =>
				validateEnvironmentMatchesHost({ ...validConfig, environment: 'prod' }),
			).not.toThrow()
		})

		it('passes when host and environment agree (dev)', () => {
			setHostname('dev.liverty-music.app')
			expect(() =>
				validateEnvironmentMatchesHost({ ...validConfig, environment: 'dev' }),
			).not.toThrow()
		})

		it('throws when prod host serves dev config', () => {
			setHostname('liverty-music.app')
			expect(() =>
				validateEnvironmentMatchesHost({ ...validConfig, environment: 'dev' }),
			).toThrow(/host 'liverty-music.app' expects environment 'prod'/)
		})

		it('skips check for unknown host (localhost)', () => {
			setHostname('localhost')
			expect(() =>
				validateEnvironmentMatchesHost({ ...validConfig, environment: 'dev' }),
			).not.toThrow()
			expect(() =>
				validateEnvironmentMatchesHost({ ...validConfig, environment: 'prod' }),
			).not.toThrow()
		})
	})
})
