import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IPasskeyClient,
	PasskeyClient,
	PasskeyRequestError,
} from '../../../src/adapter/zitadel/passkey-client'
import { IPasskeyAuthService } from '../../../src/services/passkey-auth-service'
import { createTestContainer } from '../../helpers/create-container'

const BASE = 'https://auth.test.local/v2/users/zitadel-user-1/passkeys'

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

describe('PasskeyClient (ZITADEL User v2 REST)', () => {
	let fetchMock: ReturnType<typeof vi.fn>
	let session: { userId: string; accessToken: string } | null
	let sut: PasskeyClient

	beforeEach(() => {
		fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		session = { userId: 'zitadel-user-1', accessToken: 'passkey-token' }
		const container = createTestContainer(
			Registration.instance(IPasskeyAuthService, {
				get session() {
					return session
				},
			}),
		)
		container.register(PasskeyClient)
		sut = container.get(IPasskeyClient)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('lists with POST …/passkeys/_search and the fan token, keeping usable passkeys only', async () => {
		fetchMock.mockResolvedValue(
			json(200, {
				details: { totalResult: '3' },
				result: [
					{
						id: 'pk-1',
						state: 'AUTH_FACTOR_STATE_READY',
						name: 'Windows, Chrome',
					},
					{ id: 'pk-2', state: 'AUTH_FACTOR_STATE_NOT_READY', name: 'half' },
					{ id: 'pk-3', state: 'AUTH_FACTOR_STATE_READY' },
				],
			}),
		)
		expect(await sut.list()).toEqual([
			{ id: 'pk-1', name: 'Windows, Chrome' },
			{ id: 'pk-3', name: '' },
		])
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/_search`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer passkey-token',
			},
			body: '{}',
		})
	})

	it('reads an empty list when the result field is omitted', async () => {
		fetchMock.mockResolvedValue(json(200, { details: {} }))
		expect(await sut.list()).toEqual([])
	})

	it('removes with DELETE …/passkeys/{id}', async () => {
		fetchMock.mockResolvedValue(json(200, { details: {} }))
		await sut.remove('pk-1')
		expect(fetchMock).toHaveBeenCalledWith(`${BASE}/pk-1`, {
			method: 'DELETE',
			headers: { authorization: 'Bearer passkey-token' },
		})
	})

	it('reports a rejected token as unauthenticated and other failures as failed', async () => {
		fetchMock.mockResolvedValueOnce(json(401, {}))
		await expect(sut.list()).rejects.toMatchObject({
			failure: 'unauthenticated',
		})
		fetchMock.mockResolvedValueOnce(json(503, {}))
		await expect(sut.remove('pk-1')).rejects.toMatchObject({
			failure: 'failed',
		})
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
		await expect(sut.list()).rejects.toBeInstanceOf(PasskeyRequestError)
	})

	it('sends nothing without a passkey-management session', async () => {
		session = null
		await expect(sut.list()).rejects.toMatchObject({
			failure: 'unauthenticated',
		})
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
