import { I18N } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import { IHistory } from '../../src/adapter/browser/history'
import { IAppConfig } from '../../src/config/app-config'
import type { Artist } from '../../src/entities/artist'
import {
	Events,
	IAnalyticsService,
} from '../../src/lib/analytics/analytics-service'
import { resetRevealEntryForTests } from '../../src/routes/discovery/reveal-timing'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAppConfig } from '../helpers/mock-app-config'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'
import { createMockHistory } from '../helpers/mock-history'
import { createMockI18n } from '../helpers/mock-i18n'
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
const mockIAuthService = DI.createInterface('IAuthService')

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

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
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
	let mockHistory: ReturnType<typeof createMockHistory>
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
	let mockOnboarding: {
		isOnboarding: boolean
		isCompleted: boolean
		finish: ReturnType<typeof vi.fn>
	}
	let mockAnalytics: {
		capture: ReturnType<typeof vi.fn>
		identify: ReturnType<typeof vi.fn>
		reset: ReturnType<typeof vi.fn>
		getFeatureFlag: ReturnType<typeof vi.fn>
	}
	function buildSut() {
		const container = createTestContainer(
			Registration.instance(mockIArtistStore, mockArtistClient),
			Registration.instance(mockIFollowStore, mockFollowClient),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(IAnalyticsService, mockAnalytics),
			Registration.instance(IHistory, mockHistory),
			Registration.instance(mockIAuthService, mockAuth),
		)
		container.register(DiscoveryRoute)
		const route = container.get(DiscoveryRoute)

		// Stub the dnaOrbCanvas ref. The field owner (ArtistBubbleStore) now drives
		// physics via the field binding; the route only calls the absorb flourish.
		route.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			spawnAndAbsorbAfterSearch: vi.fn(),
			bubbleCount: 0,
			canvasRect: { width: 400, height: 600 },
		} as never
		return route
	}

	beforeEach(() => {
		vi.useFakeTimers()
		resetRevealEntryForTests()
		localStorage.clear()
		mockHistory = createMockHistory()
		mockAuth = { isAuthenticated: false, signUp: vi.fn() }

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

		sut = buildSut()
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
		// @spec components/infrastructure/fan/web/route/discovery "Pre-seeded follows on page reload"
		it('should call listByArtist (not searchNewConcerts) for pre-seeded guest follows during onboarding', async () => {
			mockOnboarding.isOnboarding = true
			// The follow service facade now owns the persisted guest queue; the
			// route reads it via `guestFollows` (no IGuestService).
			const restored = [
				makeArtist('g1', 'Guest Artist'),
				makeArtist('g2', 'Second Guest'),
			]
			;(mockFollowClient as { guestFollows: unknown[] }).guestFollows =
				restored.map((artist) => ({ artist, hype: 'nearby' }))

			await sut.loading()

			expect(mockFollowClient.hydrate).toHaveBeenCalledWith(restored)
			expect(mockConcert.listByArtist).toHaveBeenCalledWith('g1')
			expect(mockConcert.listByArtist).toHaveBeenCalledWith('g2')
		})
	})

	describe('onSearchQueryChanged (debounced search)', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Search is debounced"
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

		// @spec components/infrastructure/fan/web/route/discovery "Stale search response is discarded"
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
		// @spec components/infrastructure/fan/web/route/discovery "Clear search restores bubble view"
		it('empties the query and resumes the bubble canvas', () => {
			sut.search.searchQuery = 'something'
			sut.search.onQueryChanged('something')
			expect(sut.dnaOrbCanvas.pause).toHaveBeenCalled()

			sut.clearSearch()
			sut.search.onQueryChanged(sut.search.searchQuery)

			expect(sut.search.searchQuery).toBe('')
			expect(sut.search.isSearchMode).toBe(false)
			expect(sut.dnaOrbCanvas.resume).toHaveBeenCalled()
		})
	})

	describe('search mode', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Entering search mode"
		// @spec components/infrastructure/fan/web/route/discovery "Search mode pauses the simulation"
		// @spec components/infrastructure/fan/web/route/discovery "Exiting search mode"
		// @spec components/infrastructure/fan/web/route/discovery "Search mode hides the row"
		it('hides the bubbles and the progress row while searching, and restores them when the query is cleared', () => {
			mockOnboarding.isOnboarding = true
			expect(sut.showProgressRow).toBe(true)

			sut.search.searchQuery = 'vau'
			sut.search.onQueryChanged('vau')

			expect(sut.search.isSearchMode).toBe(true)
			expect(sut.dnaOrbCanvas.pause).toHaveBeenCalled()
			expect(sut.showProgressRow).toBe(false)

			sut.search.searchQuery = ''
			sut.search.onQueryChanged('')

			expect(sut.search.isSearchMode).toBe(false)
			expect(sut.dnaOrbCanvas.resume).toHaveBeenCalled()
			expect(sut.showProgressRow).toBe(true)
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
		// @spec components/infrastructure/fan/web/route/discovery "Genre tag toggle activates and deactivates"
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

	describe('onFollowFromSearch', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Concert check after follow uses List RPC"
		// @spec components/infrastructure/fan/web/route/discovery "Onboarding user searches for an artist"
		it('should follow artist and call listByArtist (not searchNewConcerts)', async () => {
			mockOnboarding.isOnboarding = true
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

		// @spec components/infrastructure/fan/web/route/discovery "Follow failure rolls back and stays in search mode"
		it('should stay in search mode on follow failure and say the follow failed', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network error'),
			)
			sut.search.isSearchMode = true
			sut.search.searchQuery = 'test'
			sut.search.searchResults = [makeArtist('a1', 'Fail')]

			await sut.onFollowFromSearch(makeArtist('a1', 'Fail'))

			expect(sut.search.isSearchMode).toBe(true)
			expect(sut.search.searchQuery).toBe('test')
			expect(sut.search.searchResults).toHaveLength(1)
			expect(sut.dnaOrbCanvas.spawnAndAbsorbAfterSearch).not.toHaveBeenCalled()
			expect(mockEa.published).toHaveLength(1)
			expect(mockEa.published[0].severity).toBe('error')
			expect(mockEa.published[0].message).toBe(
				'discovery.followFailed name=Fail',
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Follow from search triggers absorption"
		// @spec components/infrastructure/fan/web/route/discovery "Search input is cleared after follow"
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
		// @spec components/infrastructure/fan/web/route/discovery "Guest user follows artist via bubble tap"
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
		// @spec components/infrastructure/fan/web/route/discovery "Following an already-followed artist"
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

		// @spec components/infrastructure/fan/web/route/discovery "Signed-in follow fails"
		// @spec components/infrastructure/fan/web/route/discovery "Follow RPC called on bubble tap"
		it('should re-add the bubble to the field and say the follow failed', async () => {
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
			expect(mockEa.published).toHaveLength(1)
			expect(mockEa.published[0].severity).toBe('error')
			expect(mockEa.published[0].message).toBe(
				'discovery.followFailed name=Respawn',
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Follow RPC called on bubble tap"
		it('shows the follow at once, before the server answers', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'Pending')],
			)
			await sut.refreshField()
			let answer: () => void = () => {}
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise<void>((r) => {
					answer = r
				}),
			)

			const selected = sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: {
						artist: makeArtist('a1', 'Pending'),
						position: { x: 1, y: 1 },
					},
				}),
			)

			expect(sut.bubbleStore.field.some((a) => a.id === 'a1')).toBe(false)
			answer()
			await selected
		})

		// @spec components/infrastructure/fan/web/route/discovery "Snack notification on concert found"
		// @spec components/infrastructure/fan/web/route/discovery "Live event notification on artist follow"
		it('announces the upcoming live events the lookup finds', async () => {
			;(mockConcert.listByArtist as ReturnType<typeof vi.fn>).mockResolvedValue(
				[{ id: 'c1' }],
			)

			await sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: {
						artist: makeArtist('a1', 'Vaundy'),
						position: { x: 0, y: 0 },
					},
				}),
			)
			await vi.runAllTimersAsync()

			expect(mockConcert.addArtistWithConcerts).toHaveBeenCalledWith('a1')
			expect(mockEa.published).toHaveLength(1)
			expect(mockEa.published[0].message).toBe(
				'discovery.hasUpcomingEvents name=Vaundy',
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "No notification for artists without events"
		it('shows no snack when the lookup finds no live event', async () => {
			await sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: {
						artist: makeArtist('a1', 'Quiet'),
						position: { x: 0, y: 0 },
					},
				}),
			)
			await vi.runAllTimersAsync()

			expect(mockConcert.addArtistWithConcerts).not.toHaveBeenCalled()
			expect(mockEa.published).toHaveLength(0)
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

		// @spec components/infrastructure/fan/web/route/discovery "Similar artist bubble spawning"
		// @spec components/infrastructure/fan/web/route/discovery "Successful tap and refill (Steps 3-4)"
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

		// @spec components/infrastructure/fan/web/route/discovery "Similar artists fully deduplicated"
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

		// @spec components/infrastructure/fan/web/route/discovery "No similar artists found"
		// @spec components/infrastructure/fan/web/route/discovery "Top artist pool also exhausted"
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
			expect(mockEa.published[0].message).toBe(
				'discovery.similarArtistsUnavailable name=Exhausted',
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "ListSimilar RPC failure"
		it('should show warning toast on fetch failure and evict nothing', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('kept', 'Kept')],
			)
			await sut.refreshField()
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
			expect(sut.bubbleStore.field.map((a) => a.id)).toEqual(['kept'])
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
		// @spec components/infrastructure/fan/web/route/discovery "Hidden document pauses the simulation"
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

		// @spec components/infrastructure/fan/web/route/discovery "Hidden document pauses the simulation"
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

	describe('onboarding progress row', () => {
		beforeEach(() => {
			mockOnboarding.isOnboarding = true
			// The store counts each artist whose lookup found a concert.
			;(
				mockConcert.addArtistWithConcerts as ReturnType<typeof vi.fn>
			).mockImplementation(() => {
				;(
					mockConcert as { artistsWithConcertsCount: number }
				).artistsWithConcertsCount += 1
			})
		})

		async function follow(id: string, concerts: number): Promise<void> {
			;(
				mockConcert.listByArtist as ReturnType<typeof vi.fn>
			).mockResolvedValueOnce(
				Array.from({ length: concerts }, (_, i) => ({ id: `${id}-c${i}` })),
			)
			await sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: { artist: makeArtist(id, id), position: { x: 0, y: 0 } },
				}),
			)
			await vi.runAllTimersAsync()
		}

		const percent = () => Math.round(sut.readiness * 100)

		// @spec components/infrastructure/fan/web/route/discovery "Follow without a found concert"
		it('shows 20 percent after a follow whose lookup finds no concert', async () => {
			await follow('a1', 0)
			expect(percent()).toBe(20)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Follow with a found concert"
		it('shows 20 percent after the follow and 33 percent once the lookup returns', async () => {
			let answer: (v: unknown[]) => void = () => {}
			;(
				mockConcert.listByArtist as ReturnType<typeof vi.fn>
			).mockReturnValueOnce(
				new Promise((r) => {
					answer = r
				}),
			)
			await sut.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: { artist: makeArtist('a1', 'A'), position: { x: 0, y: 0 } },
				}),
			)
			expect(percent()).toBe(20)

			answer([{ id: 'c1' }, { id: 'c2' }])
			await vi.runAllTimersAsync()

			expect(percent()).toBe(33)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Every follow advances the row"
		it('moves from 67 to 87 percent when a follow without a concert follows two with', async () => {
			await follow('a1', 1)
			await follow('a2', 3)
			expect(percent()).toBe(67)

			await follow('a3', 0)

			expect(percent()).toBe(87)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Ready by follows alone"
		it('is ready after 5 follows whose lookups find no concert', async () => {
			for (const id of ['a1', 'a2', 'a3', 'a4']) await follow(id, 0)
			expect(sut.readiness).toBeLessThan(1)

			await follow('a5', 0)

			expect(sut.readiness).toBe(1)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Ready by found concerts"
		// @spec components/infrastructure/fan/web/route/discovery "Ready timetable is offered without a spotlight"
		it('is ready after 3 follows whose lookups each find a concert, with no spotlight', async () => {
			for (const id of ['a1', 'a2', 'a3']) await follow(id, 2)

			expect(sut.readiness).toBe(1)
			expect(sut.showProgressRow).toBe(true)
			// No coach mark is published or driven from Discovery.
			expect(
				(sut as unknown as Record<string, unknown>).coachMark,
			).toBeUndefined()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Already ready when Discovery opens"
		// @spec components/infrastructure/fan/web/route/discovery "Initial page load with existing guest data"
		it('reflects the follows a guest restores on entry, ready at 5', async () => {
			const restored = ['g1', 'g2', 'g3'].map((id) => makeArtist(id, id))
			;(mockFollowClient as { guestFollows: unknown[] }).guestFollows =
				restored.map((artist) => ({ artist, hype: 'nearby' }))
			;(
				mockFollowClient.hydrate as ReturnType<typeof vi.fn>
			).mockImplementation((artists: Artist[]) => {
				for (const a of artists) simulateFollow(mockFollowClient, a)
			})

			sut.loading()
			await vi.runAllTimersAsync()

			expect(sut.followedCount).toBe(3)
			expect(percent()).toBe(60)

			// Five stored follows reach ready without a further follow.
			const ready = ['h1', 'h2', 'h3', 'h4', 'h5'].map((id) =>
				makeArtist(id, id),
			)
			mockFollowClient.followedArtists = []
			;(mockFollowClient.followedIds as Set<string>).clear()
			;(mockFollowClient as { guestFollows: unknown[] }).guestFollows =
				ready.map((artist) => ({ artist, hype: 'nearby' }))
			sut.loading()
			await vi.runAllTimersAsync()

			expect(sut.readiness).toBe(1)
			expect(mockFollowClient.follow).not.toHaveBeenCalled()
		})

		/**
		 * The route mounted with a bare template, so its `@watch` runs as in
		 * the app; the canvas and the rest of the screen are left out.
		 */
		async function mountRoute(): Promise<{
			vm: DiscoveryRoute
			stop: () => Promise<void>
		}> {
			const Mounted = CustomElement.define(
				{ name: 'mounted-discovery-route', template: '<div></div>' },
				DiscoveryRoute,
			)
			const fixture = await createFixture
				.html('<mounted-discovery-route></mounted-discovery-route>')
				.deps(
					Mounted,
					Registration.instance(mockIArtistStore, mockArtistClient),
					Registration.instance(mockIFollowStore, mockFollowClient),
					Registration.instance(mockIConcertStore, mockConcert),
					Registration.instance(IEventAggregator, mockEa),
					Registration.instance(mockIRouter, mockRouter),
					Registration.instance(mockIOnboardingService, mockOnboarding),
					Registration.instance(mockIAuthService, mockAuth),
					Registration.instance(IAnalyticsService, mockAnalytics),
					Registration.instance(I18N, createMockI18n()),
					Registration.instance(IAppConfig, createMockAppConfig()),
					Registration.instance(
						IErrorBoundaryService,
						createMockErrorBoundary(),
					),
				)
				.build().started
			const vm = CustomElement.for(
				fixture.appHost.querySelector('mounted-discovery-route') as HTMLElement,
			).viewModel as DiscoveryRoute
			vm.dnaOrbCanvas = sut.dnaOrbCanvas
			return { vm, stop: () => fixture.stop(true) as Promise<void> }
		}

		async function followOn(
			vm: DiscoveryRoute,
			id: string,
			concerts: number,
		): Promise<void> {
			;(
				mockConcert.listByArtist as ReturnType<typeof vi.fn>
			).mockResolvedValueOnce(
				Array.from({ length: concerts }, (_, i) => ({ id: `${id}-c${i}` })),
			)
			await vm.onArtistSelected(
				new CustomEvent('artist-selected', {
					detail: { artist: makeArtist(id, id), position: { x: 0, y: 0 } },
				}),
			)
			await vi.runAllTimersAsync()
			await tasksSettled()
		}

		function readyEvents(): unknown[][] {
			return mockAnalytics.capture.mock.calls.filter(
				([name]) => name === Events.OnboardingTimetableReady,
			)
		}

		// @spec components/infrastructure/fan/web/route/discovery "Timetable becomes ready"
		it('reports the ready timetable once per visit when the row becomes ready', async () => {
			const { vm, stop } = await mountRoute()
			for (const id of ['a1', 'a2', 'a3']) await followOn(vm, id, 1)
			await followOn(vm, 'a4', 1)

			expect(readyEvents()).toEqual([
				[
					Events.OnboardingTimetableReady,
					{ followed_count: 3, artists_with_concerts_count: 3 },
				],
			])
			await stop()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Ready while searching"
		it('reports the ready timetable only once the search closes', async () => {
			const { vm, stop } = await mountRoute()
			vm.search.isSearchMode = true
			for (const id of ['a1', 'a2', 'a3']) await followOn(vm, id, 1)

			expect(readyEvents()).toEqual([])

			vm.search.exitSearchMode()
			await tasksSettled()

			expect(readyEvents()).toHaveLength(1)
			await stop()
		})

		it('reports the ready timetable once per visit, with the two counts', async () => {
			const route = sut as unknown as {
				onTimetableReadyChanged(ready: boolean): void
			}
			for (const id of ['a1', 'a2', 'a3']) await follow(id, 1)

			route.onTimetableReadyChanged(sut.isOnboarding && sut.readiness >= 1)
			route.onTimetableReadyChanged(true)

			expect(
				mockAnalytics.capture.mock.calls.filter(
					([name]) => name === Events.OnboardingTimetableReady,
				),
			).toEqual([
				[
					Events.OnboardingTimetableReady,
					{ followed_count: 3, artists_with_concerts_count: 3 },
				],
			])
		})

		it('reports nothing before the timetable is ready', async () => {
			const route = sut as unknown as {
				onTimetableReadyChanged(ready: boolean): void
			}
			await follow('a1', 0)

			route.onTimetableReadyChanged(sut.isOnboarding && sut.readiness >= 1)

			expect(
				mockAnalytics.capture.mock.calls.filter(
					([name]) => name === Events.OnboardingTimetableReady,
				),
			).toEqual([])
		})

		// @spec components/infrastructure/fan/web/route/discovery "Onboarding complete"
		it('is not shown once onboarding is complete', () => {
			mockOnboarding.isOnboarding = false
			expect(sut.showProgressRow).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Onboarding guidance overlay"
		it('is shown under the genre chips while onboarding', () => {
			expect(sut.showProgressRow).toBe(true)
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

	describe('loading() — single-cache re-entry paint', () => {
		it('shows ghost bubbles on a cold visit (empty field owner)', () => {
			sut.loading()

			// Ghost bubbles are all isGhost: true — none of the field artists have real names.
			const field = sut.bubbleStore.field
			expect(field.length).toBe(50)
			expect(field.every((a) => a.isGhost === true)).toBe(true)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Re-entry paints cached artists instantly"
		// @spec components/infrastructure/fan/web/route/discovery "Tab reactivation"
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

	describe('view: artist bubbles or All Nearby', () => {
		function routeTo(query = '') {
			return { queryParams: new URLSearchParams(query) } as never
		}

		function setHidden(hidden: boolean) {
			Object.defineProperty(document, 'hidden', {
				value: hidden,
				writable: true,
			})
		}

		afterEach(() => setHidden(false))

		// @spec components/infrastructure/fan/web/route/discovery "Link to the All Nearby view"
		it('opens on the All Nearby view from /discovery?view=nearby, at any onboarding state', () => {
			sut.loading(undefined, routeTo('view=nearby'))
			expect(sut.view).toBe('nearby')

			mockOnboarding.isOnboarding = true
			const onboarding = buildSut()
			onboarding.loading(undefined, routeTo('view=nearby'))
			expect(onboarding.view).toBe('nearby')
			onboarding.attached()
			expect(onboarding.dnaOrbCanvas.pause).toHaveBeenCalled()
			onboarding.detaching()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Switching rewrites the address"
		it('rewrites the address in place on each switch, adding no history entry', () => {
			sut.loading(undefined, routeTo())
			expect(sut.view).toBe('artists')

			sut.switchView()
			expect(sut.view).toBe('nearby')
			expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
				null,
				'',
				'/discovery?view=nearby',
			)

			sut.switchView()
			expect(sut.view).toBe('artists')
			expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
				null,
				'',
				'/discovery',
			)
			expect(mockHistory.pushState).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "The last view is remembered"
		it('opens on the view the fan left on this device', () => {
			sut.loading(undefined, routeTo())
			sut.switchView()
			expect(localStorage.getItem('discovery.view')).toBe('nearby')

			// Later, from the bottom navigation (no query): a new route instance.
			const later = buildSut()
			later.loading(undefined, routeTo())
			expect(later.view).toBe('nearby')
			// The address names the view it opened on.
			later.attached()
			expect(mockHistory.replaceState).toHaveBeenLastCalledWith(
				null,
				'',
				'/discovery?view=nearby',
			)
			later.detaching()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Onboarding opens on the artist bubbles"
		it('opens on the bubbles while the fan is onboarding, whatever was used last', () => {
			localStorage.setItem('discovery.view', 'nearby')
			mockOnboarding.isOnboarding = true
			const onboarding = buildSut()
			onboarding.loading(undefined, routeTo())
			expect(onboarding.view).toBe('artists')
		})

		// @spec components/infrastructure/fan/web/route/discovery "The device keeps nothing"
		it('opens on the bubbles when the storage cannot be read or written', () => {
			const denied = () => {
				throw new DOMException('denied', 'SecurityError')
			}
			const read = vi.spyOn(localStorage, 'getItem').mockImplementation(denied)
			const write = vi.spyOn(localStorage, 'setItem').mockImplementation(denied)
			try {
				sut.loading(undefined, routeTo())
				expect(sut.view).toBe('artists')
				expect(() => sut.switchView()).not.toThrow()
				expect(sut.view).toBe('nearby')
			} finally {
				read.mockRestore()
				write.mockRestore()
			}
		})

		// @spec components/infrastructure/fan/web/route/discovery "All Nearby view pauses the simulation"
		it('pauses the bubbles on the All Nearby view and resumes them on the way back', () => {
			sut.loading(undefined, routeTo())
			sut.attached()
			const canvas = sut.dnaOrbCanvas as unknown as {
				pause: ReturnType<typeof vi.fn>
				resume: ReturnType<typeof vi.fn>
			}

			sut.switchView()
			expect(canvas.pause).toHaveBeenCalledOnce()
			expect(canvas.resume).not.toHaveBeenCalled()

			// Back while the document is visible: the bubbles run again.
			sut.switchView()
			expect(canvas.resume).toHaveBeenCalledOnce()

			// A visibility change on the All Nearby view keeps them paused.
			sut.switchView()
			setHidden(false)
			document.dispatchEvent(new Event('visibilitychange'))
			expect(canvas.resume).toHaveBeenCalledOnce()

			// Back while the document is hidden: they stay paused.
			setHidden(true)
			sut.switchView()
			expect(canvas.resume).toHaveBeenCalledOnce()
			sut.detaching()
		})

		// @spec components/infrastructure/fan/web/route/discovery "All Nearby view pauses the simulation"
		it('does not resume the bubbles under search mode', () => {
			sut.loading(undefined, routeTo('view=nearby'))
			sut.search.isSearchMode = true
			sut.switchView()
			expect(sut.dnaOrbCanvas.resume).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "The bubble field is kept while the All Nearby view is shown"
		it('keeps the bubble field and the follows across a switch and back', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeArtist('a1', 'Artist One'), makeArtist('a2', 'Artist Two')],
			)
			sut.loading(undefined, routeTo())
			await sut.refreshField()
			simulateFollow(mockFollowClient, makeArtist('f1', 'Followed'))
			const field = sut.bubbleStore.field.map((a) => a.id)

			sut.switchView()
			sut.switchView()

			expect(sut.bubbleStore.field.map((a) => a.id)).toEqual(field)
			expect(sut.followedIds.has('f1')).toBe(true)
		})

		it('keeps the All Nearby visit across switches within a visit', () => {
			sut.loading(undefined, routeTo())
			const visit = sut.nearbyVisit
			visit.areaCode = 'JP-43'
			sut.switchView()
			sut.switchView()
			expect(sut.nearbyVisit).toBe(visit)
			expect(buildSut().nearbyVisit.areaCode).toBeNull()
		})

		it('ignores a tap while the previous swap is still revealing', () => {
			let finish: () => void = () => {}
			const start = vi.fn((cb: () => void) => {
				cb()
				return {
					finished: new Promise<void>((r) => {
						finish = r
					}),
				}
			})
			Object.assign(document, { startViewTransition: start })
			try {
				sut.loading(undefined, routeTo())
				sut.switchView()
				expect(sut.view).toBe('nearby')
				expect(sut.revealing).toBe(true)

				// A second tap during the reveal changes nothing.
				sut.switchView()
				expect(start).toHaveBeenCalledOnce()
				expect(sut.view).toBe('nearby')
				finish()
			} finally {
				delete (document as { startViewTransition?: unknown })
					.startViewTransition
			}
		})

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow prompt for unauthenticated user"
		it('shows the sign-up prompt banner when a guest taps follow in the All Nearby view', () => {
			sut.offerSignUp()
			expect(sut.showSignupBanner).toBe(true)
			sut.onSignupRequested()
			expect(mockAuth.signUp).toHaveBeenCalledWith(
				expect.objectContaining({ source: 'all_nearby_prompt' }),
			)

			mockAuth.isAuthenticated = true
			const signedIn = buildSut()
			signedIn.offerSignUp()
			expect(signedIn.showSignupBanner).toBe(false)
		})

		it('hides the onboarding progress row on the All Nearby view', () => {
			mockOnboarding.isOnboarding = true
			const onboarding = buildSut()
			onboarding.loading(undefined, routeTo())
			expect(onboarding.showProgressRow).toBe(true)
			onboarding.switchView()
			expect(onboarding.showProgressRow).toBe(false)
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
