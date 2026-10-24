import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import type { Artist } from '../../src/entities/artist'
import {
	Events,
	IAnalyticsService,
} from '../../src/lib/analytics/analytics-service'
import { resetRevealEntryForTests } from '../../src/routes/discovery/reveal-timing'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'
import {
	createMockArtistServiceClient,
	createMockConcertService,
	createMockFollowStore,
} from '../helpers/mock-rpc-clients'
import { createMockEventAggregator } from '../helpers/mock-toast'

const mockIArtistStore = DI.createInterface('IArtistStore')
const mockIFollowStore = DI.createInterface('IFollowStore')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockICoachMarkService = DI.createInterface('ICoachMarkService')

// The real module (other code imports its IRouterEvents) with IRouter
// swapped; the getter defers the read past this hoisted factory.
vi.mock('@aurelia/router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@aurelia/router')>()),
	get IRouter() {
		return mockIRouter
	},
}))

vi.mock('../../src/services/artist-store', () => ({
	IArtistStore: mockIArtistStore,
}))

vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))

vi.mock('../../src/services/concert-store', () => ({
	IConcertStore: mockIConcertStore,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
}))

vi.mock('../../src/services/coach-mark-service', () => ({
	ICoachMarkService: mockICoachMarkService,
}))

vi.mock('../../src/constants/onboarding', () => ({
	DASHBOARD_FOLLOW_TARGET: 5,
	DASHBOARD_CONCERT_TARGET: 3,
}))

vi.mock('../../src/routes/discovery/discovery-route.css?raw', () => ({
	default: '',
}))

vi.mock('../../src/routes/discovery/discovery-route.$au.ts', () => ({
	default: { name: 'discovery-route', template: '<template></template>' },
}))

const preloadPhysics = vi.fn(() => Promise.resolve())
vi.mock('../../src/components/dna-orb/bubble-physics', () => ({
	preloadPhysics,
}))

vi.mock('../../src/util/detect-country', () => ({
	detectCountryFromTimezone: () => 'Japan',
}))

const { DiscoveryRoute } = await import(
	'../../src/routes/discovery/discovery-route'
)

function makeArtist(id: string, name: string): Artist {
	return { id, name, mbid: '' }
}

function simulateFollow(
	mock: ReturnType<typeof createMockFollowStore>,
	artist: Artist,
): void {
	const artists = mock.followedArtists as Artist[]
	artists.push(artist)
	;(mock.followedIds as Set<string>).add(artist.id)
	;(mock as { followedCount: number }).followedCount = artists.length
}

describe('DiscoveryRoute', () => {
	let sut: InstanceType<typeof DiscoveryRoute>
	let mockArtistClient: ReturnType<typeof createMockArtistServiceClient>
	let mockFollowClient: ReturnType<typeof createMockFollowStore>
	let mockConcert: ReturnType<typeof createMockConcertService>
	let mockEa: ReturnType<typeof createMockEventAggregator>
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockOnboarding: {
		isOnboarding: boolean
		isCompleted: boolean
		finish: ReturnType<typeof vi.fn>
	}
	let mockCoachMark: {
		active: boolean
		activate: ReturnType<typeof vi.fn>
		deactivate: ReturnType<typeof vi.fn>
	}
	let mockAnalytics: {
		capture: ReturnType<typeof vi.fn>
		identify: ReturnType<typeof vi.fn>
		reset: ReturnType<typeof vi.fn>
		getFeatureFlag: ReturnType<typeof vi.fn>
	}
	beforeEach(() => {
		vi.useFakeTimers()
		resetRevealEntryForTests()

		mockArtistClient = createMockArtistServiceClient()
		mockFollowClient = createMockFollowStore()
		mockConcert = createMockConcertService()
		mockEa = createMockEventAggregator()
		mockRouter = createMockRouter()
		mockOnboarding = {
			isOnboarding: false,
			isCompleted: true,
			finish: vi.fn(),
		}
		mockCoachMark = {
			active: false,
			activate: vi.fn(),
			deactivate: vi.fn(),
		}
		mockAnalytics = {
			capture: vi.fn(),
			identify: vi.fn(),
			reset: vi.fn(),
			getFeatureFlag: vi.fn(),
		}
		// Default: follow succeeds and updates mock state
		;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockImplementation(
			async (artist: Artist) => {
				simulateFollow(mockFollowClient, artist)
			},
		)

		const container = createTestContainer(
			Registration.instance(mockIArtistStore, mockArtistClient),
			Registration.instance(mockIFollowStore, mockFollowClient),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockICoachMarkService, mockCoachMark),
			Registration.instance(IAnalyticsService, mockAnalytics),
		)
		container.register(DiscoveryRoute)
		sut = container.get(DiscoveryRoute)

		// Stub the dnaOrbCanvas ref. The field owner (ArtistBubbleStore) now drives
		// physics via the field binding; the route only calls the absorb flourish.
		sut.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			spawnAndAbsorbAfterSearch: vi.fn(),
			bubbleCount: 0,
			canvasRect: { width: 400, height: 600 },
		} as never
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('refreshField', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Default Bubble UI display"
		it('should load initial artists via artistClient.listTop', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'Artist One')],
			)

			await sut.refreshField()

			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', '', 50)
		})

		// @spec components/infrastructure/fan/web/route/discovery "User has followed artists (Step 1-b)"
		it('loads the follows before the field, so a fan opening Discovery directly gets seed-similar bubbles', async () => {
			const followed = makeArtist('f1', 'Followed')
			;(
				mockFollowClient.ensureLoaded as ReturnType<typeof vi.fn>
			).mockImplementation(async () => {
				simulateFollow(mockFollowClient, followed)
				return [{ artist: followed, hype: 'watch' }]
			})
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue(
				Array.from({ length: 30 }, (_, i) => makeArtist(`s${i}`, `S${i}`)),
			)

			await sut.refreshField()

			expect(mockFollowClient.ensureLoaded).toHaveBeenCalled()
			expect(mockArtistClient.listSimilar).toHaveBeenCalledWith('f1', 50)
			expect(sut.bubbleStore.lastInitialLoad?.path).toBe('seed_similar')
		})

		it('still loads the field from top artists when the follows cannot be loaded', async () => {
			;(
				mockFollowClient.ensureLoaded as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('unavailable'))
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'Artist One')],
			)

			await sut.refreshField()

			expect(sut.bubbleStore.field.map((a) => a.id)).toEqual(['a1'])
			expect(mockEa.publish).not.toHaveBeenCalled()
		})

		it('should show toast on load failure', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			await sut.refreshField()

			expect(mockEa.publish).toHaveBeenCalledWith(expect.any(Snack))
			expect(mockEa.published[0].severity).toBe('error')
		})
	})

	describe('loading', () => {
		it('starts downloading the physics engine while the route loads', () => {
			preloadPhysics.mockClear()
			sut.loading()
			expect(preloadPhysics).toHaveBeenCalledTimes(1)
		})

		it('is non-blocking: returns before the initial bubble fetch settles', async () => {
			let resolveLoad: (v: Artist[]) => void = () => {}
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise((r) => {
					resolveLoad = r
				}),
			)

			// loading() returns synchronously (void) without awaiting the fetch, so
			// the router attaches the view immediately.
			const result = sut.loading()

			expect(result).toBeUndefined()
			// The fetch starts once the follows have loaded, without blocking loading().
			await vi.runAllTimersAsync()
			expect(mockArtistClient.listTop).toHaveBeenCalled()

			resolveLoad([])
		})

		// @spec components/infrastructure/fan/web/route/discovery "Follow state hydration on page reload"
		it('restores persisted guest follows before the field loads and excludes them from it', async () => {
			mockOnboarding.isOnboarding = true
			const restored = makeArtist('g1', 'Guest Artist')
			;(mockFollowClient as { guestFollows: unknown[] }).guestFollows = [
				{ artist: restored, hype: 'nearby' },
			]
			;(
				mockFollowClient.hydrate as ReturnType<typeof vi.fn>
			).mockImplementation((artists: Artist[]) => {
				for (const a of artists) simulateFollow(mockFollowClient, a)
			})
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([restored, makeArtist('s1', 'Similar')])

			sut.loading()
			await vi.runAllTimersAsync()

			expect(mockFollowClient.hydrate).toHaveBeenCalledWith([restored])
			expect(mockArtistClient.listSimilar).toHaveBeenCalledWith('g1', 50)
			expect(sut.bubbleStore.field.map((a) => a.id)).not.toContain('g1')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Concert check at page load uses List RPC"
		it('should call listByArtist (not searchNewConcerts) for pre-seeded guest follows during onboarding', async () => {
			mockOnboarding.isOnboarding = true
			// The follow service facade now owns the persisted guest queue; the
			// route reads it via `guestFollows` (no IGuestService).
			;(mockFollowClient as { guestFollows: unknown[] }).guestFollows = [
				{ artist: makeArtist('g1', 'Guest Artist'), hype: 'nearby' },
			]

			await sut.loading()

			expect(mockConcert.listByArtist).toHaveBeenCalledWith('g1')
		})
	})

	describe('onSearchQueryChanged (debounced search)', () => {
		it('should debounce search by 300ms', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeArtist('a1', 'Result'),
			])

			sut.search.searchQuery = 'test'
			sut.search.onQueryChanged('test')

			// Before 300ms
			expect(mockArtistClient.search).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(mockArtistClient.search).toHaveBeenCalledWith('test')
		})

		it('should exit search mode when query is empty', () => {
			sut.search.isSearchMode = true
			sut.search.onQueryChanged('')

			expect(sut.search.isSearchMode).toBe(false)
		})

		it('should discard stale responses by checking current query', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeArtist('a2', 'Fresh'),
			])

			sut.search.searchQuery = 'first'
			sut.search.onQueryChanged('first')

			// Before debounce fires, start a new search
			await vi.advanceTimersByTimeAsync(100)
			sut.search.searchQuery = 'second'
			sut.search.onQueryChanged('second')

			await vi.advanceTimersByTimeAsync(300)

			// Only one search should have been triggered (the second one)
			expect(mockArtistClient.search).toHaveBeenCalledTimes(1)
			expect(mockArtistClient.search).toHaveBeenCalledWith('second')
		})
	})

	describe('clearSearch', () => {
		it('should reset searchQuery', () => {
			sut.search.searchQuery = 'something'
			sut.clearSearch()
			expect(sut.search.searchQuery).toBe('')
		})
	})

	describe('onGenreSelected', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Genre filtering"
		it('should activate a genre tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')

			expect(sut.genre.activeTag).toBe('Rock')
			expect(mockArtistClient.listTop).toHaveBeenCalledWith('', 'rock', 50)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Genre deselection reverts to regional results"
		it('should deactivate when selecting same tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.genre.activeTag).toBe('')
			expect(mockArtistClient.listTop).toHaveBeenLastCalledWith('Japan', '', 50)
		})
	})

	describe('dashboard coach mark', () => {
		it('reports the coach mark with the follow and concert counts', () => {
			// @spec components/infrastructure/fan/web/route/discovery "Coach mark appears"
			mockOnboarding.isOnboarding = true
			Object.assign(mockFollowClient, { followedCount: 3 })
			Object.assign(mockConcert, { artistsWithConcertsCount: 2 })
			const route = sut as unknown as {
				onShowDashboardCoachMarkChanged(show: boolean): void
			}

			route.onShowDashboardCoachMarkChanged(true)
			// The coach mark appears once per visit.
			route.onShowDashboardCoachMarkChanged(true)

			expect(mockCoachMark.activate).toHaveBeenCalledOnce()
			expect(
				mockAnalytics.capture.mock.calls.filter(
					([name]) => name === Events.OnboardingCoachmarkShown,
				),
			).toEqual([
				[
					Events.OnboardingCoachmarkShown,
					{ followed_count: 3, artists_with_concerts_count: 2 },
				],
			])
		})
	})

	describe('onCoachMarkTap', () => {
		it('should only dismiss the coach mark without mutating onboarding or navigating', () => {
			mockOnboarding.isOnboarding = true

			sut.onCoachMarkTap()

			expect(mockCoachMark.deactivate).toHaveBeenCalledTimes(1)
			expect(mockOnboarding.finish).not.toHaveBeenCalled()
			expect(mockRouter.load).not.toHaveBeenCalled()
		})
	})

	describe('onFollowFromSearch', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Concert check after follow uses List RPC"
		it('should follow artist and call listByArtist (not searchNewConcerts)', async () => {
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeArtist('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1' }),
			)
			expect(mockConcert.listByArtist).toHaveBeenCalledWith('a1')
		})

		it('should not follow already-followed artist', async () => {
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeArtist('a1', 'Artist'))

			// Try to follow again
			await sut.onFollowFromSearch(makeArtist('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should stay in search mode on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network error'),
			)
			sut.search.isSearchMode = true
			sut.search.searchQuery = 'test'

			await sut.onFollowFromSearch(makeArtist('a1', 'Fail'))

			expect(sut.search.isSearchMode).toBe(true)
			expect(sut.search.searchQuery).toBe('test')
			expect(sut.dnaOrbCanvas.spawnAndAbsorbAfterSearch).not.toHaveBeenCalled()
		})

		it('should exit search mode and trigger the absorb flourish on success', async () => {
			sut.search.isSearchMode = true
			sut.search.searchQuery = 'query'
			sut.search.searchResults = [makeArtist('a1', 'Artist')]

			const artist = makeArtist('a1', 'Artist')
			await sut.onFollowFromSearch(artist)

			expect(sut.search.isSearchMode).toBe(false)
			expect(sut.search.searchQuery).toBe('')
			expect(sut.search.searchResults).toHaveLength(0)
			// The route removes the artist from the field and delegates the absorb
			// animation to the canvas (which owns the rAF + zero-rect guard).
			expect(sut.dnaOrbCanvas.spawnAndAbsorbAfterSearch).toHaveBeenCalledWith(
				artist,
			)
		})
	})

	describe('onArtistSelected', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Concert check after follow uses List RPC"
		it('should follow artist and call listByArtist (not searchNewConcerts) via event detail', async () => {
			const artist = makeArtist('a1', 'Artist One')
			const event = new CustomEvent('artist-selected', {
				detail: { artist, position: { x: 100, y: 200 } },
			})

			await sut.onArtistSelected(event)

			expect(mockFollowClient.follow).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1' }),
			)
			expect(mockConcert.listByArtist).toHaveBeenCalledWith('a1')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Already-followed artists"
		it('should skip if artist already followed', async () => {
			const artist = makeArtist('a1', 'Artist')
			const event = new CustomEvent('artist-selected', {
				detail: { artist, position: { x: 0, y: 0 } },
			})

			await sut.onArtistSelected(event)
			await sut.onArtistSelected(event)

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should rollback bubble on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('rpc fail'),
			)

			const artist = makeArtist('a1', 'RollbackArtist')
			const event = new CustomEvent('artist-selected', {
				detail: { artist, position: { x: 50, y: 50 } },
			})
			await sut.onArtistSelected(event)

			expect(mockConcert.listByArtist).not.toHaveBeenCalled()
		})

		it('should re-add the bubble to the field on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: makeArtist('a1', 'Respawn'),
					position: { x: 100, y: 200 },
				},
			})
			await sut.onArtistSelected(event)

			// Rollback re-adds it to the field (the reconcile pops it back in at the
			// tap position via the recorded placement hint).
			expect(sut.bubbleStore.field.some((a) => a.id === 'a1')).toBe(true)
			expect(sut.bubbleStore.pendingPlacements.get('a1')).toEqual({
				x: 100,
				y: 200,
			})
		})
	})

	describe('onNeedMoreBubbles', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Tap on a revealed artist while other bubbles are still ghosts"
		it('adds similar artists after the initial load for a tap during the reveal, with no unavailable snack', async () => {
			simulateFollow(mockFollowClient, makeArtist('f1', 'Followed'))
			let answerSeed: (v: Artist[]) => void = () => {}
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockImplementation((id: string) =>
				id === 'f1'
					? new Promise<Artist[]>((r) => {
							answerSeed = r
						})
					: Promise.resolve([makeArtist('tapSim', 'Tap Similar')]),
			)
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)
			sut.loading()
			// Let the follows load so the initial load is in flight.
			await vi.advanceTimersByTimeAsync(0)
			expect(mockArtistClient.listSimilar).toHaveBeenCalledWith('f1', 50)
			answerSeed([makeArtist('r1', 'Revealed')])

			// The fan taps the revealed artist before the initial load finished.
			const tapped = makeArtist('r1', 'Revealed')
			const selected = sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: { artist: tapped, position: { x: 5, y: 5 } },
				}),
			)
			await sut.onNeedMoreBubbles(
				new CustomEvent('need-more-bubbles', {
					detail: {
						artistId: 'r1',
						artistName: 'Revealed',
						position: { x: 5, y: 5 },
					},
				}),
			)
			await selected

			expect(mockFollowClient.follow).toHaveBeenCalledWith(tapped)
			expect(sut.bubbleStore.field.some((a) => a.id === 'tapSim')).toBe(true)
			expect(mockEa.publish).not.toHaveBeenCalledWith(expect.any(Snack))
		})

		it('should fetch similar artists and add them at the tap position', async () => {
			const similar = [makeArtist('s1', 'Similar 1')]
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue(similar)

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'Tapped',
					position: { x: 50, y: 50 },
				},
			})

			await sut.onNeedMoreBubbles(event)

			expect(mockArtistClient.listSimilar).toHaveBeenCalledWith('a1', 30)
			// The field owner adds the similar artist with the tap-position placement.
			expect(sut.bubbleStore.field.some((a) => a.id === 's1')).toBe(true)
			expect(sut.bubbleStore.pendingPlacements.get('s1')).toEqual({
				x: 50,
				y: 50,
			})
		})

		it('should fall back to top artists when similar returns empty', async () => {
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([])
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('t1', 'Top Fallback')],
			)

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'NoSimilar',
					position: { x: 0, y: 0 },
				},
			})
			await sut.onNeedMoreBubbles(event)

			expect(mockArtistClient.listTop).toHaveBeenCalled()
			expect(sut.bubbleStore.field.some((a) => a.id === 't1')).toBe(true)
		})

		it('should evict the oldest bubbles (FIFO) when the field is full', async () => {
			// Fill the field to MAX with oldest→newest.
			const initial = Array.from({ length: 50 }, (_, i) =>
				makeArtist(`existing${i}`, `Existing ${i}`),
			)
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				initial,
			)
			await sut.refreshField()
			expect(sut.bubbleStore.field).toHaveLength(50)

			const similar = [makeArtist('new1', 'New One')]
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue(similar)

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'Source',
					position: { x: 0, y: 0 },
				},
			})
			await sut.onNeedMoreBubbles(event)

			// New similar admitted, oldest evicted, still capped at 50.
			expect(sut.bubbleStore.field).toHaveLength(50)
			expect(sut.bubbleStore.field.some((a) => a.id === 'new1')).toBe(true)
			expect(sut.bubbleStore.field.some((a) => a.id === 'existing0')).toBe(
				false,
			)
		})

		it('should show info toast when no new bubbles are available', async () => {
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([])
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'Exhausted',
					position: { x: 0, y: 0 },
				},
			})
			await sut.onNeedMoreBubbles(event)

			expect(mockEa.published.length).toBe(1)
			expect(mockEa.published[0].severity).toBe('info')
		})

		it('should show warning toast on fetch failure', async () => {
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('network'))

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'Failing',
					position: { x: 0, y: 0 },
				},
			})
			await sut.onNeedMoreBubbles(event)

			expect(mockEa.published.length).toBe(1)
			expect(mockEa.published[0].severity).toBe('warning')
		})
	})

	describe('loading with existing followed artists (seed similar)', () => {
		it('should fetch seed similar artists when followedArtists is non-empty', async () => {
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeArtist('f1', 'Followed One'))

			// Now the initial load should call listSimilar (seed) instead of listTop
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([makeArtist('s1', 'Seed Similar')])

			await sut.refreshField()

			expect(mockArtistClient.listSimilar).toHaveBeenCalled()
		})
	})

	describe('visibility change', () => {
		it('should pause canvas when document becomes hidden', () => {
			sut.attached()

			Object.defineProperty(document, 'hidden', {
				value: true,
				writable: true,
			})
			document.dispatchEvent(new Event('visibilitychange'))

			expect(sut.dnaOrbCanvas.pause).toHaveBeenCalled()

			// Cleanup
			Object.defineProperty(document, 'hidden', {
				value: false,
				writable: true,
			})
			sut.detaching()
		})

		it('should resume canvas when document becomes visible and not in search mode', () => {
			sut.attached()
			sut.search.isSearchMode = false

			Object.defineProperty(document, 'hidden', {
				value: false,
				writable: true,
			})
			document.dispatchEvent(new Event('visibilitychange'))

			expect(sut.dnaOrbCanvas.resume).toHaveBeenCalled()
			sut.detaching()
		})

		it('should NOT resume canvas when document becomes visible but in search mode', () => {
			sut.attached()
			sut.search.isSearchMode = true

			Object.defineProperty(document, 'hidden', {
				value: false,
				writable: true,
			})
			document.dispatchEvent(new Event('visibilitychange'))

			expect(sut.dnaOrbCanvas.resume).not.toHaveBeenCalled()
			sut.detaching()
		})
	})

	describe('followedCount', () => {
		it('should always read from followService.followedCount', async () => {
			;(mockFollowClient as { followedCount: number }).followedCount = 5
			expect(sut.followedCount).toBe(5)
		})

		it('should reflect follow calls', async () => {
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeArtist('a1', 'A'))
			await sut.onFollowFromSearch(makeArtist('a2', 'B'))

			expect(sut.followedCount).toBe(2)
		})
	})

	describe('showDashboardCoachMark', () => {
		it('should hide when not onboarding', () => {
			mockOnboarding.isOnboarding = false
			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('should hide when onboarding but artistsWithConcertsCount < TUTORIAL_FOLLOW_TARGET', () => {
			mockOnboarding.isOnboarding = true
			;(
				mockConcert as { artistsWithConcertsCount: number }
			).artistsWithConcertsCount = 2
			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-01: should be false when artistsWithConcertsCount is 0 despite follows', () => {
			mockOnboarding.isOnboarding = true
			;(
				mockConcert as { artistsWithConcertsCount: number }
			).artistsWithConcertsCount = 0

			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-02: should be true when artistsWithConcertsCount >= 3', () => {
			mockOnboarding.isOnboarding = true
			;(
				mockConcert as { artistsWithConcertsCount: number }
			).artistsWithConcertsCount = 3

			expect(sut.showDashboardCoachMark).toBe(true)
		})
	})

	describe('bubble field', () => {
		it('reflects the artists loaded by the field owner', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'Field Artist')],
			)

			await sut.refreshField()

			expect(sut.bubbleStore.field).toHaveLength(1)
			expect(sut.bubbleStore.field[0].name).toBe('Field Artist')
		})
	})

	describe('onboarding snack notification', () => {
		it('should not publish a popoverGuide Snack when onboarding (replaced by PageHelp)', () => {
			mockOnboarding.isOnboarding = true

			sut.attached()

			const snackCalls = (
				mockEa.publish as ReturnType<typeof vi.fn>
			).mock.calls.filter(
				([arg]: [unknown]) =>
					arg instanceof Snack &&
					(arg as Snack).message === 'discovery.popoverGuide',
			)
			expect(snackCalls).toHaveLength(0)
			sut.detaching()
		})

		it('should not publish a Snack when not onboarding', () => {
			mockOnboarding.isOnboarding = false

			sut.attached()

			const snackCalls = (
				mockEa.publish as ReturnType<typeof vi.fn>
			).mock.calls.filter(([arg]: [unknown]) => arg instanceof Snack)
			expect(snackCalls).toHaveLength(0)
			sut.detaching()
		})
	})

	describe('coach mark trigger (live counts)', () => {
		it('activates the coach mark via CoachMarkService when the live follow threshold is met', () => {
			mockOnboarding.isOnboarding = true
			;(mockFollowClient as { followedCount: number }).followedCount = 5

			// Drive the @watch by re-evaluating the trigger.
			;(
				sut as unknown as {
					onShowDashboardCoachMarkChanged(show: boolean): void
				}
			).onShowDashboardCoachMarkChanged(sut.showDashboardCoachMark)

			expect(sut.showDashboardCoachMark).toBe(true)
			expect(mockCoachMark.activate).toHaveBeenCalledTimes(1)
			// onTap is navigation-only and never advances a step.
			const onTap = mockCoachMark.activate.mock.calls[0][2] as () => void
			onTap()
			expect(mockOnboarding.finish).not.toHaveBeenCalled()
			expect(mockRouter.load).not.toHaveBeenCalled()
		})

		it('shows the coach mark at most once per session', () => {
			mockOnboarding.isOnboarding = true
			;(mockFollowClient as { followedCount: number }).followedCount = 5

			;(
				sut as unknown as {
					onShowDashboardCoachMarkChanged(show: boolean): void
				}
			).onShowDashboardCoachMarkChanged(true)
			;(
				sut as unknown as {
					onShowDashboardCoachMarkChanged(show: boolean): void
				}
			).onShowDashboardCoachMarkChanged(true)

			expect(mockCoachMark.activate).toHaveBeenCalledTimes(1)
		})

		it('does not activate the coach mark when not onboarding', () => {
			mockOnboarding.isOnboarding = false
			;(mockFollowClient as { followedCount: number }).followedCount = 5

			;(
				sut as unknown as {
					onShowDashboardCoachMarkChanged(show: boolean): void
				}
			).onShowDashboardCoachMarkChanged(sut.showDashboardCoachMark)

			expect(sut.showDashboardCoachMark).toBe(false)
			expect(mockCoachMark.activate).not.toHaveBeenCalled()
		})

		it('deactivates the coach mark on detaching', () => {
			sut.detaching()
			expect(mockCoachMark.deactivate).toHaveBeenCalled()
		})
	})

	describe('loading() — single-cache re-entry paint', () => {
		it('shows ghost bubbles on a cold visit (empty field owner)', () => {
			sut.loading()

			// Ghost bubbles are all isGhost: true — none of the field artists have real names.
			const field = sut.bubbleStore.field
			expect(field.length).toBe(50)
			expect(field.every((a) => a.isGhost === true)).toBe(true)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Re-entry paints cached artists instantly"
		it('re-uses the persisted field on re-entry (no ghosts) and re-applies invariants', async () => {
			// Warm the field owner (the singleton IS the cache).
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[
					{ id: 'a1', name: 'YOASOBI', mbid: '' },
					{ id: 'a2', name: 'Ado', mbid: '' },
				],
			)
			await sut.refreshField()

			// Re-entry: the persisted field is re-applied (real artists, no ghosts).
			sut.loading()

			const field = sut.bubbleStore.field
			expect(field.map((a) => a.id)).toEqual(['a1', 'a2'])
			expect(field.every((a) => !a.isGhost)).toBe(true)
		})

		it('holds the loaded field in the owner (no second cache) after refreshField', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[{ id: 'a1', name: 'YOASOBI', mbid: '' }],
			)

			await sut.refreshField()

			expect(sut.bubbleStore.field.map((a) => a.id)).toEqual(['a1'])
		})
	})

	describe('screen reader status', () => {
		it('does not count ghost placeholders as available artists', async () => {
			let answer: (v: Artist[]) => void = () => {}
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise<Artist[]>((r) => {
					answer = r
				}),
			)

			sut.loading()
			expect(sut.srStatusText).toContain('discovery.srArtistsAvailable count=0')

			answer([makeArtist('a1', 'One'), makeArtist('a2', 'Two')])
			await vi.runAllTimersAsync()
			expect(sut.srStatusText).toContain('discovery.srArtistsAvailable count=2')
		})
	})

	describe('cold-load reveal timing', () => {
		function revealMark(
			mark: 'ghosts' | 'first-name' | 'all-names',
			time: number,
		): CustomEvent<{ mark: typeof mark; time: number }> {
			return new CustomEvent('reveal-mark', { detail: { mark, time } })
		}

		function navigationAt(url: string): void {
			vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
				{ name: url } as PerformanceEntry,
			])
		}

		function revealAll(times: [number, number, number]): void {
			sut.onRevealMark(revealMark('ghosts', times[0]))
			sut.onRevealMark(revealMark('first-name', times[1]))
			sut.onRevealMark(revealMark('all-names', times[2]))
		}

		// @spec components/infrastructure/fan/web/route/discovery "Cold visit with followed artists"
		it('sends one event with the seed-similar path, seed count, entry and timings', async () => {
			navigationAt(window.location.href)
			simulateFollow(mockFollowClient, makeArtist('f1', 'One'))
			simulateFollow(mockFollowClient, makeArtist('f2', 'Two'))
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([makeArtist('s1', 'Similar')])

			sut.loading()
			await vi.runAllTimersAsync()
			revealAll([120.4, 900, 1500.6])
			// Marks after the reveal completed do not send a second event.
			sut.onRevealMark(revealMark('all-names', 2000))

			expect(mockAnalytics.capture).toHaveBeenCalledTimes(1)
			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'perf.discovery_reveal',
				{
					entry: 'page_load',
					path: 'seed_similar',
					seed_count: 2,
					ghosts_ms: 120,
					first_name_ms: 900,
					all_names_ms: 1501,
				},
			)
		})

		it('measures an in-app entry from the route loading, on the top path', async () => {
			navigationAt(`${window.location.origin}/some-other-page`)
			vi.spyOn(performance, 'now').mockReturnValue(1000)

			sut.loading()
			await vi.runAllTimersAsync()
			revealAll([1100, 1400, 1800])

			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'perf.discovery_reveal',
				{
					entry: 'in_app',
					path: 'top',
					seed_count: 0,
					ghosts_ms: 100,
					first_name_ms: 400,
					all_names_ms: 800,
				},
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Artists arrive before a ghost is drawn"
		it('sends the event when the first frame already shows every name', async () => {
			navigationAt(window.location.href)

			sut.loading()
			await vi.runAllTimersAsync()
			revealAll([7000, 7000, 7000])

			expect(mockAnalytics.capture).toHaveBeenCalledWith(
				'perf.discovery_reveal',
				expect.objectContaining({
					ghosts_ms: 7000,
					first_name_ms: 7000,
					all_names_ms: 7000,
				}),
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Re-entry"
		it('sends nothing when a re-entry paints the cached field', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'YOASOBI')],
			)
			await sut.refreshField()
			sut.loading() // the first visit
			await vi.runAllTimersAsync()
			sut.detaching()

			sut.loading() // the re-entry
			await vi.runAllTimersAsync()
			revealAll([100, 200, 300])

			expect(mockAnalytics.capture).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Leaving before the reveal completes"
		it('sends nothing when the fan leaves before every bubble shows a name', async () => {
			sut.loading()
			await vi.runAllTimersAsync()
			sut.onRevealMark(revealMark('ghosts', 100))
			sut.onRevealMark(revealMark('first-name', 200))

			sut.detaching()
			sut.onRevealMark(revealMark('all-names', 300))

			expect(mockAnalytics.capture).not.toHaveBeenCalled()
		})
	})

	describe('bubble field cap — 50 upper limit', () => {
		it('ghost field is initialised to exactly MAX_BUBBLES on cold visit', () => {
			sut.loading()

			// All 50 slots filled with ghost placeholders — field never exceeds cap.
			expect(sut.bubbleStore.field.length).toBe(50)
			expect(sut.bubbleStore.field.every((a) => a.isGhost === true)).toBe(true)
		})

		it('re-entry with a warm field does not exceed MAX_BUBBLES', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				Array.from({ length: 60 }, (_, i) => ({
					id: `artist-${i}`,
					name: `Artist ${i}`,
					mbid: '',
				})),
			)
			await sut.refreshField()

			sut.loading()

			expect(sut.bubbleStore.field.length).toBeLessThanOrEqual(50)
		})
	})
})
