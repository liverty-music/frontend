import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

const mockRpc = {
	search: vi.fn(),
	create: vi.fn(),
	get: vi.fn(),
	listByOrganizer: vi.fn(),
}

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

	it('create wraps the name and MBID and returns the artist', async () => {
		mockRpc.create.mockResolvedValue({ artist: { id: { value: 'a-new' } } })
		const client = resolveClient()

		const artist = await client.create('E2E Test Artist', 'mbid-1')

		const [req] = mockRpc.create.mock.calls.at(-1) ?? []
		expect(req.name?.value).toBe('E2E Test Artist')
		expect(req.mbid?.value).toBe('mbid-1')
		expect(artist?.id?.value).toBe('a-new')
	})

	it('propagates create errors', async () => {
		mockRpc.create.mockRejectedValue(new Error('exists'))
		const client = resolveClient()

		await expect(client.create('X', 'mbid-1')).rejects.toThrow('exists')
	})

	it('get wraps the artist id and returns the artist', async () => {
		mockRpc.get.mockResolvedValue({ artist: { id: { value: 'a1' } } })
		const client = resolveClient()

		const artist = await client.get('a1')

		const [req] = mockRpc.get.mock.calls.at(-1) ?? []
		expect(req.artistId?.value).toBe('a1')
		expect(artist?.id?.value).toBe('a1')
	})

	it('get returns null when no artist has the id', async () => {
		const { Code, ConnectError } = await import('@connectrpc/connect')
		mockRpc.get.mockRejectedValue(new ConnectError('no artist', Code.NotFound))
		const client = resolveClient()

		expect(await client.get('a-missing')).toBeNull()
	})
})
