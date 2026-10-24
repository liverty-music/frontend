import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

const mockRpc = { list: vi.fn(), listByArtist: vi.fn(), delete: vi.fn() }

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

vi.mock('../../../admin/services/admin-transport', () => ({
	createAdminTransport: vi.fn().mockReturnValue({}),
}))

const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IConcertClient } = await import(
	'../../../admin/services/concert-client'
)

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		IConcertClient,
	)
	return container.get(IConcertClient)
}

const emptyResponse = { concerts: [], series: [], artists: [] }

describe('ConcertClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('list sends no artist', async () => {
		mockRpc.list.mockResolvedValue(emptyResponse)

		await resolveClient().list()

		const [req] = mockRpc.list.mock.calls.at(-1) ?? []
		expect(req).toEqual({})
	})

	it('listByArtist wraps the artist id', async () => {
		mockRpc.listByArtist.mockResolvedValue(emptyResponse)

		const concerts = await resolveClient().listByArtist('a1')

		const [req] = mockRpc.listByArtist.mock.calls.at(-1) ?? []
		expect(req.artistId?.value).toBe('a1')
		expect(concerts).toEqual([])
	})

	it('propagates listByArtist errors', async () => {
		mockRpc.listByArtist.mockRejectedValue(new Error('not found'))

		await expect(resolveClient().listByArtist('a1')).rejects.toThrow(
			'not found',
		)
	})
})
