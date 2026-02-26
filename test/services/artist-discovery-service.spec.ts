import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtistBubble } from '../../src/services/artist-discovery-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'
import { createMockToastService } from '../helpers/mock-toast'

// Stub external modules before importing the SUT
const mockArtistService = { typeName: 'ArtistService' }
const mockCreatePromiseClient = vi.fn()
const mockCreateTransport = vi.fn().mockReturnValue({})

vi.mock(
	'@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js',
	() => ({
		ArtistService: mockArtistService,
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
	createPromiseClient: mockCreatePromiseClient,
}))

vi.mock('../../src/services/grpc-transport', () => ({
	createTransport: mockCreateTransport,
}))

const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const mockIToastService = DI.createInterface('IToastService')
vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
}))

const { ArtistDiscoveryService, IArtistDiscoveryService } = await import(
	'../../src/services/artist-discovery-service'
)

function makeArtist(id: string, name: string, mbid = '') {
	return {
		id: { value: id },
		name: { value: name },
		mbid: { value: mbid },
	}
}

function _makeBubble(id: string, name: string, mbid = ''): ArtistBubble {
	return {
		id,
		name,
		mbid,
		imageUrl: '',
		x: 0,
		y: 0,
		radius: 40,
	}
}

describe('ArtistDiscoveryService', () => {
	let sut: InstanceType<typeof ArtistDiscoveryService>
	let mockClient: Record<string, ReturnType<typeof vi.fn>>
	let mockToast: ReturnType<typeof createMockToastService>

	beforeEach(() => {
		mockClient = {
			listTop: vi.fn().mockResolvedValue({ artists: [] }),
			search: vi.fn().mockResolvedValue({ artists: [] }),
			follow: vi.fn().mockResolvedValue({}),
			listSimilar: vi.fn().mockResolvedValue({ artists: [] }),
			listFollowed: vi.fn().mockResolvedValue({ artists: [] }),
		}
		mockCreatePromiseClient.mockReturnValue(mockClient)

		const mockAuth = createMockAuth({ isAuthenticated: true })
		mockToast = createMockToastService()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIToastService, mockToast),
		)
		container.register(ArtistDiscoveryService)
		sut = container.get(IArtistDiscoveryService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('loadInitialArtists', () => {
		it('should populate availableBubbles from listTop response', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [
					makeArtist('a1', 'Artist One'),
					makeArtist('a2', 'Artist Two'),
				],
			})

			await sut.loadInitialArtists()

			expect(sut.availableBubbles).toHaveLength(2)
			expect(sut.availableBubbles[0].name).toBe('Artist One')
			expect(sut.maxBubbles).toBe(2)
		})

		it('should pass country and tag to listTop', async () => {
			mockClient.listTop.mockResolvedValue({ artists: [] })

			await sut.loadInitialArtists('US', 'rock')

			expect(mockClient.listTop).toHaveBeenCalledWith({
				country: 'US',
				tag: 'rock',
			})
		})

		it('should default country to Japan and tag to empty', async () => {
			mockClient.listTop.mockResolvedValue({ artists: [] })

			await sut.loadInitialArtists()

			expect(mockClient.listTop).toHaveBeenCalledWith({
				country: 'Japan',
				tag: '',
			})
		})
	})

	describe('deduplication', () => {
		it('should exclude followed artists from available bubbles on reload', async () => {
			// Follow an artist first
			mockClient.listTop.mockResolvedValueOnce({
				artists: [makeArtist('a1', 'Followed Artist')],
			})
			await sut.loadInitialArtists()
			await sut.followArtist(sut.availableBubbles[0])

			// Reload — followed artist should be deduped via name/id
			mockClient.listTop.mockResolvedValueOnce({
				artists: [makeArtist('a1', 'Followed Artist')],
			})
			await sut.loadInitialArtists()
			expect(sut.availableBubbles).toHaveLength(0)
		})

		it('should exclude followed artists by name on reload', async () => {
			mockClient.listTop.mockResolvedValueOnce({
				artists: [makeArtist('a1', 'Artist X')],
			})
			await sut.loadInitialArtists()
			await sut.followArtist(sut.availableBubbles[0])

			// Same name, different id
			mockClient.listTop.mockResolvedValueOnce({
				artists: [makeArtist('a2', 'Artist X')],
			})
			await sut.loadInitialArtists()
			expect(sut.availableBubbles).toHaveLength(0)
		})

		it('should track seen artists across getSimilarArtists calls', async () => {
			mockClient.listSimilar.mockResolvedValueOnce({
				artists: [makeArtist('s1', 'Similar One')],
			})
			await sut.getSimilarArtists('Base', 'a1')

			// Same artist returned again — should be filtered
			mockClient.listSimilar.mockResolvedValueOnce({
				artists: [makeArtist('s1', 'Similar One')],
			})
			const result = await sut.getSimilarArtists('Base', 'a1')
			expect(result).toHaveLength(0)
		})
	})

	describe('followArtist', () => {
		it('should optimistically move artist from available to followed', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Artist One')],
			})
			await sut.loadInitialArtists()
			const artist = sut.availableBubbles[0]

			await sut.followArtist(artist)

			expect(sut.availableBubbles).toHaveLength(0)
			expect(sut.followedArtists).toHaveLength(1)
			expect(sut.followedArtists[0].id).toBe('a1')
		})

		it('should update orbIntensity on follow', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Artist One')],
			})
			await sut.loadInitialArtists()

			await sut.followArtist(sut.availableBubbles[0])

			expect(sut.orbIntensity).toBe(Math.min(1, 1 / 20))
		})

		it('should not follow an already followed artist', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Artist One')],
			})
			await sut.loadInitialArtists()
			const artist = sut.availableBubbles[0]

			await sut.followArtist(artist)
			await sut.followArtist(artist) // second call should be no-op

			expect(mockClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should retry once on first follow failure', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Artist One')],
			})
			await sut.loadInitialArtists()
			const artist = sut.availableBubbles[0]

			mockClient.follow
				.mockRejectedValueOnce(new Error('network'))
				.mockResolvedValueOnce({})

			await sut.followArtist(artist)

			expect(mockClient.follow).toHaveBeenCalledTimes(2)
			expect(sut.followedArtists).toHaveLength(1)
		})

		it('should rollback optimistic update when follow fails after retry', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Artist One')],
			})
			await sut.loadInitialArtists()
			const artist = sut.availableBubbles[0]

			mockClient.follow.mockRejectedValue(new Error('persistent error'))

			await expect(sut.followArtist(artist)).rejects.toThrow('persistent error')

			expect(sut.followedArtists).toHaveLength(0)
			expect(sut.availableBubbles).toHaveLength(1)
			expect(sut.isFollowed('a1')).toBe(false)
			expect(mockToast.show).toHaveBeenCalledWith('Failed to follow Artist One')
		})
	})

	describe('reloadWithTag', () => {
		it('should reload available bubbles with new tag', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Rock Artist')],
			})

			await sut.reloadWithTag('rock')

			expect(mockClient.listTop).toHaveBeenCalledWith({
				country: 'Japan',
				tag: 'rock',
			})
			expect(sut.availableBubbles).toHaveLength(1)
		})
	})

	describe('evictOldest', () => {
		it('should remove the first N bubbles from availableBubbles', async () => {
			mockClient.listTop.mockResolvedValue({
				artists: [
					makeArtist('a1', 'A1'),
					makeArtist('a2', 'A2'),
					makeArtist('a3', 'A3'),
				],
			})
			await sut.loadInitialArtists()

			const evicted = sut.evictOldest(2)

			expect(evicted).toHaveLength(2)
			expect(evicted[0].id).toBe('a1')
			expect(sut.availableBubbles).toHaveLength(1)
			expect(sut.availableBubbles[0].id).toBe('a3')
		})

		it('should return empty array for count <= 0', () => {
			const evicted = sut.evictOldest(0)
			expect(evicted).toHaveLength(0)
		})
	})

	describe('getSimilarArtists', () => {
		it('should fetch and append similar artists to availableBubbles', async () => {
			mockClient.listSimilar.mockResolvedValue({
				artists: [
					makeArtist('s1', 'Similar One'),
					makeArtist('s2', 'Similar Two'),
				],
			})

			const result = await sut.getSimilarArtists('Base Artist', 'a1')

			expect(result).toHaveLength(2)
			expect(sut.availableBubbles).toHaveLength(2)
		})

		it('should filter out already-seen similar artists', async () => {
			// First load to populate seen sets
			mockClient.listTop.mockResolvedValue({
				artists: [makeArtist('a1', 'Existing')],
			})
			await sut.loadInitialArtists()

			mockClient.listSimilar.mockResolvedValue({
				artists: [
					makeArtist('a1', 'Existing'), // duplicate
					makeArtist('s1', 'New Artist'),
				],
			})

			const result = await sut.getSimilarArtists('Base', 'a1')

			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('New Artist')
		})
	})

	describe('orbIntensity', () => {
		it('should be 0 when no artists are followed', () => {
			expect(sut.orbIntensity).toBe(0)
		})

		it('should cap at 1 when 20+ artists are followed', async () => {
			const artists = Array.from({ length: 21 }, (_, i) =>
				makeArtist(`a${i}`, `Artist ${i}`),
			)
			mockClient.listTop.mockResolvedValue({ artists })
			await sut.loadInitialArtists()

			for (const bubble of [...sut.availableBubbles]) {
				await sut.followArtist(bubble)
			}

			expect(sut.orbIntensity).toBe(1)
		})
	})

	describe('listFollowedFromBackend', () => {
		it('should return bubbles from backend listFollowed', async () => {
			mockClient.listFollowed.mockResolvedValue({
				artists: [
					{ artist: makeArtist('a1', 'Followed One') },
					{ artist: makeArtist('a2', 'Followed Two') },
				],
			})

			const result = await sut.listFollowedFromBackend()

			expect(result).toHaveLength(2)
			expect(result[0].name).toBe('Followed One')
		})

		it('should skip entries with missing artist', async () => {
			mockClient.listFollowed.mockResolvedValue({
				artists: [{ artist: makeArtist('a1', 'Valid') }, { artist: null }, {}],
			})

			const result = await sut.listFollowedFromBackend()

			expect(result).toHaveLength(1)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()
			mockClient.listFollowed.mockResolvedValue({ artists: [] })

			await sut.listFollowedFromBackend(controller.signal)

			expect(mockClient.listFollowed).toHaveBeenCalledWith(
				{},
				{ signal: controller.signal },
			)
		})

		it('should rethrow errors from backend', async () => {
			mockClient.listFollowed.mockRejectedValue(new Error('network error'))

			await expect(sut.listFollowedFromBackend()).rejects.toThrow(
				'network error',
			)
		})
	})
})
