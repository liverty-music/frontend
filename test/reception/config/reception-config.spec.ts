import { describe, expect, it, vi } from 'vitest'
import {
	loadReceptionConfig,
	validateReceptionConfig,
} from '../../../reception/config/reception-config'
import bundledConfig from '../../../reception/public/config.json'

const VALID = {
	environment: 'prod',
	apiBaseUrl: 'https://api.reception.liverty-music.app',
	logLevel: 'info',
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

describe('validateReceptionConfig', () => {
	it('accepts the reception config', () => {
		expect(validateReceptionConfig(VALID)).toEqual(VALID)
	})

	it('accepts the config bundled with the reception app', () => {
		expect(validateReceptionConfig(bundledConfig)).toEqual(VALID)
	})

	it('rejects a console config mounted by mistake', () => {
		expect(() =>
			validateReceptionConfig({
				...VALID,
				apiBaseUrl: 'https://api.organizer.liverty-music.app',
				zitadelIssuer: 'https://auth.liverty-music.app',
				zitadelClientId: '1',
			}),
		).toThrow(/unexpected field\(s\).*zitadelIssuer, zitadelClientId/)
	})

	it('rejects a missing API base URL', () => {
		expect(() =>
			validateReceptionConfig({ environment: 'prod', logLevel: 'info' }),
		).toThrow(/apiBaseUrl/)
	})

	it('rejects an unknown environment or log level', () => {
		expect(() =>
			validateReceptionConfig({ ...VALID, environment: 'qa' }),
		).toThrow(/environment/)
		expect(() =>
			validateReceptionConfig({ ...VALID, logLevel: 'verbose' }),
		).toThrow(/logLevel/)
	})

	it('rejects a non-object document', () => {
		expect(() => validateReceptionConfig([])).toThrow(/JSON object/)
	})
})

describe('loadReceptionConfig', () => {
	it('fetches /config.json without the cache and validates it', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(VALID))
		await expect(loadReceptionConfig(fetchImpl)).resolves.toEqual(VALID)
		expect(fetchImpl).toHaveBeenCalledWith(
			'/config.json',
			expect.objectContaining({ cache: 'no-store' }),
		)
	})

	it('fails when the fetch is not OK', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404))
		await expect(loadReceptionConfig(fetchImpl)).rejects.toThrow(/HTTP 404/)
	})

	it('fails when the body is not JSON', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('<html>', { status: 200 }))
		await expect(loadReceptionConfig(fetchImpl)).rejects.toThrow(/parse failed/)
	})
})
