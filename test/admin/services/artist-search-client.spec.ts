import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'

const mockRpc = { search: vi.fn() }

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

const mockCreateConnectTransport = vi.fn().mockReturnValue({})
vi.mock('@connectrpc/connect-web', () => ({
	createConnectTransport: mockCreateConnectTransport,
}))

const { IAppConfig } = await import('../../../shared/config/app-config')
const { IArtistSearchClient } = await import(
	'../../../admin/services/artist-search-client'
)

function resolveClient(apiBaseUrl = 'https://api.consumer.test') {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig({ apiBaseUrl })),
		IArtistSearchClient,
	)
	return container.get(IArtistSearchClient)
}

describe('ArtistSearchClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('targets the consumer API host (not the admin host)', () => {
		resolveClient('https://api.consumer.test')
		const call = mockCreateConnectTransport.mock.calls.at(-1)?.[0]
		expect(call.baseUrl).toBe('https://api.consumer.test')
		// Public procedure: no interceptors are attached.
		expect(call.interceptors).toBeUndefined()
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
})
