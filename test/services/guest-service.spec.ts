import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../src/entities/artist'
import { DEFAULT_HYPE, type FollowedArtist } from '../../src/entities/follow'
import { createMockLogger } from '../helpers/mock-logger'

vi.mock('../../src/adapter/storage/guest-storage', () => ({
	loadFollows: vi.fn().mockReturnValue([]),
	saveFollows: vi.fn(),
	loadHome: vi.fn().mockReturnValue(null),
	saveHome: vi.fn(),
}))

const { loadFollows, loadHome } = await import(
	'../../src/adapter/storage/guest-storage'
)

const { GuestService } = await import('../../src/services/guest-service')

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

function makeFollow(
	id: string,
	name: string,
	hype: FollowedArtist['hype'] = DEFAULT_HYPE,
): FollowedArtist {
	return { artist: makeArtist(id, name), hype }
}

function createService(
	overrides: { follows?: FollowedArtist[]; home?: string | null } = {},
): InstanceType<typeof GuestService> {
	vi.mocked(loadFollows).mockReturnValue(
		overrides.follows ? [...overrides.follows] : [],
	)
	vi.mocked(loadHome).mockReturnValue(overrides.home ?? null)

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	return container.invoke(GuestService)
}

describe('GuestService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('follow', () => {
		it('should add artist to follows with DEFAULT_HYPE', () => {
			const sut = createService()
			const artist = makeArtist('a1', 'Artist One')

			sut.follow(artist)

			expect(sut.follows).toHaveLength(1)
			expect(sut.follows[0].artist.id).toBe('a1')
			expect(sut.follows[0].artist.name).toBe('Artist One')
			expect(sut.follows[0].hype).toBe(DEFAULT_HYPE)
		})

		it('should be a no-op if artist is already followed', () => {
			const artist = makeArtist('a1', 'Artist One')
			const sut = createService({
				follows: [makeFollow('a1', 'Artist One')],
			})

			sut.follow(artist)

			expect(sut.follows).toHaveLength(1)
		})

		it('should allow following multiple distinct artists', () => {
			const sut = createService()

			sut.follow(makeArtist('a1', 'One'))
			sut.follow(makeArtist('a2', 'Two'))
			sut.follow(makeArtist('a3', 'Three'))

			expect(sut.follows).toHaveLength(3)
		})
	})

	describe('unfollow', () => {
		it('should remove artist by id', () => {
			const sut = createService({
				follows: [makeFollow('a1', 'One'), makeFollow('a2', 'Two')],
			})

			sut.unfollow('a1')

			expect(sut.follows).toHaveLength(1)
			expect(sut.follows[0].artist.id).toBe('a2')
		})

		it('should be a no-op if artist is not followed', () => {
			const sut = createService({
				follows: [makeFollow('a1', 'One')],
			})

			sut.unfollow('nonexistent')

			expect(sut.follows).toHaveLength(1)
		})
	})

	describe('setHype', () => {
		it('should update hype for a followed artist', () => {
			const sut = createService({
				follows: [makeFollow('a1', 'One')],
			})

			sut.setHype('a1', 'away')

			expect(sut.follows[0].hype).toBe('away')
		})

		it('should be a no-op if artist is not followed', () => {
			const sut = createService({
				follows: [makeFollow('a1', 'One')],
			})

			sut.setHype('unknown', 'away')

			expect(sut.follows[0].hype).toBe(DEFAULT_HYPE)
		})
	})

	describe('setHome', () => {
		it('should set home code', () => {
			const sut = createService()

			sut.setHome('JP-13')

			expect(sut.home).toBe('JP-13')
		})
	})

	describe('clearAll', () => {
		it('should empty follows and null home', () => {
			const sut = createService({
				follows: [makeFollow('a1', 'One'), makeFollow('a2', 'Two')],
				home: 'JP-13',
			})

			sut.clearAll()

			expect(sut.follows).toHaveLength(0)
			expect(sut.home).toBeNull()
		})
	})

	describe('followedCount', () => {
		it('should return 0 for empty follows', () => {
			const sut = createService()
			expect(sut.followedCount).toBe(0)
		})

		it('should reflect number of followed artists', () => {
			const sut = createService({
				follows: [
					makeFollow('a1', 'One'),
					makeFollow('a2', 'Two'),
					makeFollow('a3', 'Three'),
				],
			})
			expect(sut.followedCount).toBe(3)
		})

		it('should update after follow/unfollow', () => {
			const sut = createService()

			sut.follow(makeArtist('a1', 'One'))
			expect(sut.followedCount).toBe(1)

			sut.follow(makeArtist('a2', 'Two'))
			expect(sut.followedCount).toBe(2)

			sut.unfollow('a1')
			expect(sut.followedCount).toBe(1)
		})
	})

	describe('listFollowed', () => {
		it('should return empty array when no follows', () => {
			const sut = createService()
			expect(sut.listFollowed()).toEqual([])
		})

		it('should project id and name from follows', () => {
			const sut = createService({
				follows: [
					makeFollow('a1', 'Artist One'),
					makeFollow('a2', 'Artist Two'),
				],
			})

			const result = sut.listFollowed()

			expect(result).toEqual([
				{ id: 'a1', name: 'Artist One' },
				{ id: 'a2', name: 'Artist Two' },
			])
		})

		it('should reflect mutations after follow', () => {
			const sut = createService()

			sut.follow(makeArtist('a1', 'New Artist'))

			expect(sut.listFollowed()).toEqual([{ id: 'a1', name: 'New Artist' }])
		})
	})
})
