import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

// Stub the generated Connect client behind createClient so the wrapper's
// request marshalling + logging can be asserted without a real transport.
const mockRpc = {
	create: vi.fn(),
	list: vi.fn(),
	get: vi.fn(),
	listArtists: vi.fn(),
	associateArtist: vi.fn(),
	disassociateArtist: vi.fn(),
	deactivate: vi.fn(),
}

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

// The admin transport is exercised by its own spec; stub it here.
vi.mock('../../../admin/services/admin-transport', () => ({
	createAdminTransport: vi.fn().mockReturnValue({}),
}))

const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IOrganizerClient } = await import(
	'../../../admin/services/organizer-client'
)

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		IOrganizerClient,
	)
	return container.get(IOrganizerClient)
}

describe('OrganizerClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('create wraps name + operator email and returns the organizer', async () => {
		mockRpc.create.mockResolvedValue({ organizer: { id: { value: 'o1' } } })
		const client = resolveClient()

		const result = await client.create('Acme', 'owner@acme.test')

		const [req] = mockRpc.create.mock.calls.at(-1) ?? []
		expect(req.name?.value).toBe('Acme')
		expect(req.operatorEmail?.value).toBe('owner@acme.test')
		expect(result?.id?.value).toBe('o1')
	})

	it('list returns the organizers array', async () => {
		mockRpc.list.mockResolvedValue({ organizers: [{ id: { value: 'o1' } }] })
		const client = resolveClient()

		const organizers = await client.list()

		expect(organizers).toHaveLength(1)
	})

	it('get wraps the organizer id', async () => {
		mockRpc.get.mockResolvedValue({ organizer: { id: { value: 'o1' } } })
		const client = resolveClient()

		await client.get('o1')

		const [req] = mockRpc.get.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
	})

	it('listArtists wraps the organizer id and returns artists', async () => {
		mockRpc.listArtists.mockResolvedValue({
			artists: [{ id: { value: 'a1' } }],
		})
		const client = resolveClient()

		const artists = await client.listArtists('o1')

		const [req] = mockRpc.listArtists.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
		expect(artists).toHaveLength(1)
	})

	it('associateArtist wraps both ids', async () => {
		mockRpc.associateArtist.mockResolvedValue({})
		const client = resolveClient()

		await client.associateArtist('o1', 'a1')

		const [req] = mockRpc.associateArtist.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
		expect(req.artistId?.value).toBe('a1')
	})

	it('disassociateArtist wraps both ids', async () => {
		mockRpc.disassociateArtist.mockResolvedValue({})
		const client = resolveClient()

		await client.disassociateArtist('o1', 'a1')

		const [req] = mockRpc.disassociateArtist.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
		expect(req.artistId?.value).toBe('a1')
	})

	it('deactivate wraps the organizer id', async () => {
		mockRpc.deactivate.mockResolvedValue({})
		const client = resolveClient()

		await client.deactivate('o1')

		const [req] = mockRpc.deactivate.mock.calls.at(-1) ?? []
		expect(req.organizerId?.value).toBe('o1')
	})

	it('propagates errors from the underlying client', async () => {
		mockRpc.list.mockRejectedValue(new Error('rpc down'))
		const client = resolveClient()

		await expect(client.list()).rejects.toThrow('rpc down')
	})
})
