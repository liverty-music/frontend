import { IStore } from '@aurelia/state'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import type { ArtistBubble } from '../../src/services/artist-service-client'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'
import {
	createMockArtistServiceClient,
	createMockConcertService,
	createMockFollowServiceClient,
} from '../helpers/mock-rpc-clients'
import { createMockStore } from '../helpers/mock-store'
import { createMockEventAggregator } from '../helpers/mock-toast'

const mockIArtistServiceClient = DI.createInterface('IArtistServiceClient')
const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockIConcertService = DI.createInterface('IConcertService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/artist-service-client', () => ({
	IArtistServiceClient: mockIArtistServiceClient,
}))

vi.mock('../../src/services/follow-service-client', () => ({
	IFollowServiceClient: mockIFollowServiceClient,
}))

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
	OnboardingStep: {
		LP: 'lp',
		DISCOVERY: 'discovery',
		DASHBOARD: 'dashboard',
		DETAIL: 'detail',
		MY_ARTISTS: 'my-artists',
		COMPLETED: 'completed',
	},
}))

vi.mock('../../src/routes/discovery/discovery-route.css?raw', () => ({
	default: '',
}))

const { DiscoveryRoute } = await import(
	'../../src/routes/discovery/discovery-route'
)

function makeBubble(id: string, name: string): ArtistBubble {
	return { id, name, mbid: '', imageUrl: '', x: 0, y: 0, radius: 30 }
}

describe('DiscoveryRoute', () => {
	let sut: InstanceType<typeof DiscoveryRoute>
	let mockArtistClient: ReturnType<typeof createMockArtistServiceClient>
	let mockFollowClient: ReturnType<typeof createMockFollowServiceClient>
	let mockConcert: ReturnType<typeof createMockConcertService>
	let mockEa: ReturnType<typeof createMockEventAggregator>
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockOnboarding: {
		currentStep: string
		isOnboarding: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
		activateSpotlight: ReturnType<typeof vi.fn>
		deactivateSpotlight: ReturnType<typeof vi.fn>
	}
	let mockStoreInstance: ReturnType<typeof createMockStore>

	beforeEach(() => {
		vi.useFakeTimers()

		mockArtistClient = createMockArtistServiceClient()
		mockFollowClient = createMockFollowServiceClient()
		mockConcert = createMockConcertService()
		mockEa = createMockEventAggregator()
		mockRouter = createMockRouter()
		mockOnboarding = {
			currentStep: 'completed',
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
			activateSpotlight: vi.fn(),
			deactivateSpotlight: vi.fn(),
		}
		mockStoreInstance = createMockStore()

		const container = createTestContainer(
			Registration.instance(mockIArtistServiceClient, mockArtistClient),
			Registration.instance(mockIFollowServiceClient, mockFollowClient),
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(IStore, mockStoreInstance.store),
		)
		container.register(DiscoveryRoute)
		sut = container.get(DiscoveryRoute)

		// Stub the dnaOrbCanvas ref
		sut.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			reloadBubbles: vi.fn(),
			spawnBubblesAt: vi.fn(),
			spawnAndAbsorb: vi.fn(),
			fadeOutBubbles: vi.fn(),
			bubbleCount: 0,
			canvasRect: { width: 400, height: 600 },
		} as any
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('loading', () => {
		it('should load initial artists via artistClient.listTop', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeBubble('a1', 'Artist One')],
			)

			await sut.loading()

			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', '', 50)
		})

		it('should show toast on load failure', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			await sut.loading()

			expect(mockEa.publish).toHaveBeenCalledWith(expect.any(Toast))
			expect(mockEa.published[0].severity).toBe('error')
		})
	})

	describe('onSearchQueryChanged (debounced search)', () => {
		it('should debounce search by 300ms', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a1', 'Result'),
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
				makeBubble('a2', 'Fresh'),
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
		it('should activate a genre tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')

			expect(sut.genre.activeTag).toBe('Rock')
			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', 'rock', 50)
		})

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

	describe('onCoachMarkTap', () => {
		it('should set step to DASHBOARD and navigate to /dashboard', async () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.currentStep = 'discovery'

			sut.onCoachMarkTap()

			expect(mockOnboarding.setStep).toHaveBeenCalledWith('dashboard') // DASHBOARD
			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})
	})

	describe('onFollowFromSearch', () => {
		it('should follow artist and check live events', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[{ id: 'c1' }],
			)

			// Mock rAF for spawnAndAbsorbAfterSearch
			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledWith('a1', 'Artist')
		})

		it('should not follow already-followed artist', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)

			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			// Try to follow again
			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should stay in search mode on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network error'),
			)
			sut.search.isSearchMode = true
			sut.search.searchQuery = 'test'

			await sut.onFollowFromSearch(makeBubble('a1', 'Fail'))

			expect(sut.search.isSearchMode).toBe(true)
			expect(sut.search.searchQuery).toBe('test')
			expect(sut.dnaOrbCanvas.spawnAndAbsorb).not.toHaveBeenCalled()
			const hasErrorToast = mockEa.published.some(
				(t: Toast) => t.severity === 'error',
			)
			expect(hasErrorToast).toBe(true)
		})

		it('should exit search mode and trigger spawnAndAbsorb on success', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			sut.search.isSearchMode = true
			sut.search.searchQuery = 'query'
			sut.search.searchResults = [makeBubble('a1', 'Artist')]

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(sut.search.isSearchMode).toBe(false)
			expect(sut.search.searchQuery).toBe('')
			expect(sut.search.searchResults).toHaveLength(0)
			expect(sut.dnaOrbCanvas.spawnAndAbsorb).toHaveBeenCalledTimes(1)
		})

		it('should call spawnAndAbsorb with center-x and 17% height position', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			const artist = makeBubble('a1', 'Artist')
			await sut.onFollowFromSearch(artist)

			// canvasRect mock: { width: 400, height: 600 }
			expect(sut.dnaOrbCanvas.spawnAndAbsorb).toHaveBeenCalledWith(
				artist,
				200, // 400 / 2
				expect.closeTo(102, 0), // 600 * 0.17
			)
		})
	})

	describe('onArtistSelected', () => {
		it('should follow artist and request similar artists via event detail', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			const artist = makeBubble('a1', 'Artist One')
			const event = new CustomEvent('artist-selected', {
				detail: { artist, position: { x: 100, y: 200 } },
			})

			await sut.onArtistSelected(event)

			expect(mockFollowClient.follow).toHaveBeenCalledWith('a1', 'Artist One')
		})

		it('should skip if artist already followed', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			const artist = makeBubble('a1', 'Artist')
			const event = new CustomEvent('artist-selected', {
				detail: { artist, position: { x: 0, y: 0 } },
			})

			await sut.onArtistSelected(event)
			await sut.onArtistSelected(event)

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should show toast when artist has upcoming live events', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[{ id: 'c1' }],
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: makeBubble('a1', 'Live Band'),
					position: { x: 0, y: 0 },
				},
			})
			await sut.onArtistSelected(event)

			// Wait for the fire-and-forget concert check to resolve
			await vi.advanceTimersByTimeAsync(0)

			expect(mockConcert.listConcerts).toHaveBeenCalledWith('a1')
			expect(mockEa.publish).toHaveBeenCalled()
		})

		it('should show error toast on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network error'),
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: makeBubble('a1', 'Fail Artist'),
					position: { x: 10, y: 20 },
				},
			})
			await sut.onArtistSelected(event)

			// followArtist publishes a toast via callback
			expect(mockEa.published.length).toBeGreaterThanOrEqual(1)
			const hasErrorToast = mockEa.published.some(
				(t: Toast) => t.severity === 'error',
			)
			expect(hasErrorToast).toBe(true)
		})
	})

	describe('followArtist rollback on RPC failure', () => {
		it('should rollback followedArtists on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('rpc fail'),
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: makeBubble('a1', 'RollbackArtist'),
					position: { x: 50, y: 50 },
				},
			})
			await sut.onArtistSelected(event)

			// followedArtists should be empty after rollback
			expect(sut.followedCount).toBe(0)
			expect(sut.followedIds.has('a1')).toBe(false)
		})

		it('should re-spawn bubble at original position on follow failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			const event = new CustomEvent('artist-selected', {
				detail: {
					artist: makeBubble('a1', 'Respawn'),
					position: { x: 100, y: 200 },
				},
			})
			await sut.onArtistSelected(event)

			expect(sut.dnaOrbCanvas.spawnBubblesAt).toHaveBeenCalledWith(
				[expect.objectContaining({ id: 'a1' })],
				100,
				200,
			)
		})
	})

	describe('onNeedMoreBubbles', () => {
		it('should fetch similar artists and spawn them at tap position', async () => {
			const similar = [makeBubble('s1', 'Similar 1')]
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
			expect(sut.dnaOrbCanvas.spawnBubblesAt).toHaveBeenCalledWith(
				similar,
				50,
				50,
			)
		})

		it('should fall back to top artists when similar returns empty', async () => {
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([])
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeBubble('t1', 'Top Fallback')],
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
			expect(sut.dnaOrbCanvas.spawnBubblesAt).toHaveBeenCalled()
		})

		it('should evict oldest bubbles when pool is full', async () => {
			// Fill the pool up to MAX
			const initial = Array.from({ length: 50 }, (_, i) =>
				makeBubble(`existing${i}`, `Existing ${i}`),
			)
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				initial,
			)
			await sut.loading()

			// Mock canvas bubbleCount to match pool
			;(sut.dnaOrbCanvas as any).bubbleCount = 50

			const similar = [makeBubble('new1', 'New One')]
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue(similar)
			;(
				sut.dnaOrbCanvas.fadeOutBubbles as ReturnType<typeof vi.fn>
			).mockResolvedValue(undefined)

			const event = new CustomEvent('need-more-bubbles', {
				detail: {
					artistId: 'a1',
					artistName: 'Source',
					position: { x: 0, y: 0 },
				},
			})
			await sut.onNeedMoreBubbles(event)

			expect(sut.dnaOrbCanvas.fadeOutBubbles).toHaveBeenCalled()
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
			// Pre-populate followed artists
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeBubble('f1', 'Followed One'))

			// Now loading should call listSimilar (seed) instead of listTop
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockResolvedValue([makeBubble('s1', 'Seed Similar')])

			await sut.loading()

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

	describe('onboarding followedCount delegation', () => {
		it('should read from store guest.follows during onboarding', () => {
			mockOnboarding.isOnboarding = true
			// Add follows to the mock store state
			mockStoreInstance.state.guest.follows = [
				{ artistId: 'a1', name: 'A1' },
				{ artistId: 'a2', name: 'A2' },
				{ artistId: 'a3', name: 'A3' },
				{ artistId: 'a4', name: 'A4' },
				{ artistId: 'a5', name: 'A5' },
			]

			expect(sut.followedCount).toBe(5)
		})

		it('should use followedArtists.length when not onboarding', async () => {
			mockOnboarding.isOnboarding = false
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			;(mockConcert.listConcerts as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
				cb(0)
				return 0
			})

			await sut.onFollowFromSearch(makeBubble('a1', 'A'))
			await sut.onFollowFromSearch(makeBubble('a2', 'B'))

			expect(sut.followedCount).toBe(2)
		})
	})

	describe('showDashboardCoachMark', () => {
		it('should hide when not onboarding', () => {
			mockOnboarding.isOnboarding = false
			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('should hide when onboarding but followed < ONBOARDING_FOLLOW_TARGET', () => {
			mockOnboarding.isOnboarding = true
			mockStoreInstance.state.guest.follows = [
				{ artistId: 'a1', name: 'A1' },
				{ artistId: 'a2', name: 'A2' },
			]
			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-01: should be false when concertGroupCount is 0 despite 3+ follows and all searches complete', () => {
			mockOnboarding.isOnboarding = true
			mockStoreInstance.state.guest.follows = [
				{ artistId: 'a1', name: 'A1' },
				{ artistId: 'a2', name: 'A2' },
				{ artistId: 'a3', name: 'A3' },
			]
			sut.concertTracker.completedSearchCount = 3
			sut.concertTracker.concertGroupCount = 0

			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-02: should be true when concertGroupCount > 0 with 3+ follows and all searches complete', () => {
			mockOnboarding.isOnboarding = true
			mockStoreInstance.state.guest.follows = [
				{ artistId: 'a1', name: 'A1' },
				{ artistId: 'a2', name: 'A2' },
				{ artistId: 'a3', name: 'A3' },
			]
			sut.concertTracker.completedSearchCount = 3
			sut.concertTracker.concertGroupCount = 2

			expect(sut.showDashboardCoachMark).toBe(true)
		})
	})

	describe('poolBubbles', () => {
		it('should reflect pool availableBubbles', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[makeBubble('a1', 'Pool Artist')],
			)

			await sut.loading()

			expect(sut.poolBubbles).toHaveLength(1)
			expect(sut.poolBubbles[0].name).toBe('Pool Artist')
		})
	})

	describe('onboarding popover', () => {
		it('should call showPopover on attach when onboarding', () => {
			mockOnboarding.isOnboarding = true
			const mockPopover = { showPopover: vi.fn() }
			sut.onboardingGuide = mockPopover as any

			sut.attached()

			expect(mockPopover.showPopover).toHaveBeenCalledTimes(1)
			sut.detaching()
		})

		it('should not call showPopover when not onboarding', () => {
			mockOnboarding.isOnboarding = false
			const mockPopover = { showPopover: vi.fn() }
			sut.onboardingGuide = mockPopover as any

			sut.attached()

			expect(mockPopover.showPopover).not.toHaveBeenCalled()
			sut.detaching()
		})
	})

	describe('onCoachMarkTap (Home nav step advancement)', () => {
		it('should deactivate spotlight, advance step to DASHBOARD, and navigate', () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.currentStep = 'discovery' // DISCOVERY
			mockStoreInstance.state.guest.follows = [
				{ artistId: 'a1', name: 'A1' },
				{ artistId: 'a2', name: 'A2' },
				{ artistId: 'a3', name: 'A3' },
			]

			sut.onCoachMarkTap()

			expect(mockOnboarding.deactivateSpotlight).toHaveBeenCalledTimes(1)
			expect(mockOnboarding.setStep).toHaveBeenCalledWith('dashboard') // DASHBOARD
			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should not advance step when showDashboardCoachMark is false (fewer than 3 follows)', () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.currentStep = 'discovery' // DISCOVERY
			mockStoreInstance.state.guest.follows = [{ artistId: 'a1', name: 'A1' }]

			// showDashboardCoachMark should be false
			expect(sut.showDashboardCoachMark).toBe(false)
		})
	})
})
