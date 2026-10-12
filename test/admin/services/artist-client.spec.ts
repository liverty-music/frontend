import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

const mockRpc = { search: vi.fn(), listByOrganizer: vi.fn() }

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

// ArtistService.Search is called over the authenticated admin transport (served
// by the admin server via api.admin). The transport has its own spec; stub it.
const mockCreateAdminTransport = vi.fn().mockReturnValue({})
vi.mock('../../../admin/services/admin-transport', () => ({
	createAdminTransport: mockCreateAdminTransport,
}))

const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IArtistClient } = await import('../../../admin/services/artist-client')

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		IArtistClient,
	)
	return container.get(IArtistClient)
}

describe('ArtistClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('uses the authenticated admin transport (not a consumer transport)', () => {
		resolveClient()
		// Search rides the admin host + admin token, so no cross-origin call to
		// the consumer API is made; both services share the one transport.
		expect(mockCreateAdminTransport).toHaveBeenCalledTimes(1)
	})

	it('search forwards the query and returns the artists array', async () => {
		mockRpc.search.mockResolvedValue({ artists: [{ id: { value: 'a1' } }] })
		const client = resolveClient()

		const artists = await client.search('radiohead')

		const [req] = mockRpc.search.mock.calls.at(-1) ?? []
		expect(req.query).toBe('radiohead')
		expect(artists).toHaveLength(1)
	})

	it('propagates search errors', async () => {
		mockRpc.search.mockRejectedValue(new Error('too short'))
		const client = resolveClient()

		await expect(client.search('a')).rejects.toThrow('too short')
	})

	it('listByOrganizer wraps the organizer id and returns artists', async () => {
		mockRpc.listByOrganizer.mockResolvedValue({
			artists: [{ id: { value: 'a1' } }],
		})
		const client = resolveClient()

		const artists = await client.listByOrganizer('o1')

		const [req] = mockRpc.listByOrganizer.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
		expect(artists).toHaveLength(1)
	})
})
