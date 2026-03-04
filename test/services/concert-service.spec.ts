import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const mockConcertService = { typeName: 'ConcertService' }
const mockCreateClient = vi.fn()
const mockCreateTransport = vi.fn().mockReturnValue({})

vi.mock(
	'@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js',
	() => ({
		ConcertService: mockConcertService,
	}),
)

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js',
	() => ({
		ArtistId: class ArtistId {
			value: string
			constructor({ value }: { value: string }) {
				this.value = value
			}
		},
	}),
)

vi.mock('@connectrpc/connect', () => ({
	createClient: mockCreateClient,
}))

vi.mock('../../src/services/grpc-transport', () => ({
	createTransport: mockCreateTransport,
}))

const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { ConcertServiceClient, IConcertService } = await import(
	'../../src/services/concert-service'
)

describe('ConcertServiceClient', () => {
	let sut: InstanceType<typeof ConcertServiceClient>
	let mockClient: Record<string, ReturnType<typeof vi.fn>>

	beforeEach(() => {
		mockClient = {
			list: vi.fn().mockResolvedValue({ concerts: [] }),
			listByFollower: vi.fn().mockResolvedValue({ concerts: [] }),
			searchNewConcerts: vi.fn().mockResolvedValue({}),
			listSearchStatuses: vi.fn().mockResolvedValue({ statuses: [] }),
		}
		mockCreateClient.mockReturnValue(mockClient)

		const mockAuth = createMockAuth({ isAuthenticated: true })
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
		)
		container.register(ConcertServiceClient)
		sut = container.get(IConcertService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('listConcerts', () => {
		it('should return concerts from the backend', async () => {
			const fakeConcerts = [{ id: 'c1' }, { id: 'c2' }]
			mockClient.list.mockResolvedValue({ concerts: fakeConcerts })

			const result = await sut.listConcerts('artist-1')

			expect(result).toEqual(fakeConcerts)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()
			mockClient.list.mockResolvedValue({ concerts: [] })

			await sut.listConcerts('artist-1', controller.signal)

			expect(mockClient.list).toHaveBeenCalledWith(
				expect.objectContaining({}),
				{ signal: controller.signal },
			)
		})

		it('should rethrow errors', async () => {
			mockClient.list.mockRejectedValue(new Error('rpc error'))

			await expect(sut.listConcerts('artist-1')).rejects.toThrow('rpc error')
		})
	})

	describe('listByFollower', () => {
		it('should return concerts for followed artists', async () => {
			const fakeConcerts = [{ id: 'c1' }]
			mockClient.listByFollower.mockResolvedValue({
				concerts: fakeConcerts,
			})

			const result = await sut.listByFollower()

			expect(result).toEqual(fakeConcerts)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()
			mockClient.listByFollower.mockResolvedValue({ concerts: [] })

			await sut.listByFollower(controller.signal)

			expect(mockClient.listByFollower).toHaveBeenCalledWith(
				{},
				{ signal: controller.signal },
			)
		})

		it('should rethrow errors', async () => {
			mockClient.listByFollower.mockRejectedValue(new Error('rpc error'))

			await expect(sut.listByFollower()).rejects.toThrow('rpc error')
		})
	})

	describe('searchNewConcerts', () => {
		it('should call searchNewConcerts on the client', async () => {
			await sut.searchNewConcerts('artist-1')

			expect(mockClient.searchNewConcerts).toHaveBeenCalledTimes(1)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.searchNewConcerts('artist-1', controller.signal)

			expect(mockClient.searchNewConcerts).toHaveBeenCalledWith(
				expect.objectContaining({}),
				expect.objectContaining({
					signal: controller.signal,
				}),
			)
		})

		it('should rethrow errors', async () => {
			mockClient.searchNewConcerts.mockRejectedValue(new Error('search failed'))

			await expect(sut.searchNewConcerts('artist-1')).rejects.toThrow(
				'search failed',
			)
		})
	})

	describe('listSearchStatuses', () => {
		it('should return statuses for given artist IDs', async () => {
			const fakeStatuses = [
				{ artistId: { value: 'a1' }, status: 2 },
				{ artistId: { value: 'a2' }, status: 1 },
			]
			mockClient.listSearchStatuses.mockResolvedValue({
				statuses: fakeStatuses,
			})

			const result = await sut.listSearchStatuses(['a1', 'a2'])

			expect(result).toEqual(fakeStatuses)
			expect(mockClient.listSearchStatuses).toHaveBeenCalledTimes(1)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.listSearchStatuses(['a1'], controller.signal)

			expect(mockClient.listSearchStatuses).toHaveBeenCalledWith(
				expect.objectContaining({}),
				expect.objectContaining({ signal: controller.signal }),
			)
		})

		it('should rethrow errors', async () => {
			mockClient.listSearchStatuses.mockRejectedValue(
				new Error('poll failed'),
			)

			await expect(sut.listSearchStatuses(['a1'])).rejects.toThrow(
				'poll failed',
			)
		})
	})
})
