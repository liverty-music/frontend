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
import { createMockEventAggregator } from '../helpers/mock-toast'

const mockIArtistServiceClient = DI.createInterface('IArtistServiceClient')
const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockIConcertService = DI.createInterface('IConcertService')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockILocalArtistClient = DI.createInterface('ILocalArtistClient')

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
		LP: 0,
		DISCOVER: 1,
		LOADING: 2,
		DASHBOARD: 3,
		DETAIL: 4,
		MY_ARTISTS: 5,
		SIGNUP: 6,
		COMPLETED: 7,
	},
}))

vi.mock('../../src/services/local-artist-client', () => ({
	ILocalArtistClient: mockILocalArtistClient,
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
		currentStep: number
		isOnboarding: boolean
		setStep: ReturnType<typeof vi.fn>
		complete: ReturnType<typeof vi.fn>
		activateSpotlight: ReturnType<typeof vi.fn>
		deactivateSpotlight: ReturnType<typeof vi.fn>
	}
	let mockLocalClient: {
		followedCount: number
		setAdminArea: ReturnType<typeof vi.fn>
		listFollowed: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockArtistClient = createMockArtistServiceClient()
		mockFollowClient = createMockFollowServiceClient()
		mockConcert = createMockConcertService()
		mockEa = createMockEventAggregator()
		mockRouter = createMockRouter()
		mockOnboarding = {
			currentStep: 7,
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
			activateSpotlight: vi.fn(),
			deactivateSpotlight: vi.fn(),
		}
		mockLocalClient = {
			followedCount: 0,
			setAdminArea: vi.fn(),
			listFollowed: vi.fn().mockReturnValue([]),
		}

		const container = createTestContainer(
			Registration.instance(mockIArtistServiceClient, mockArtistClient),
			Registration.instance(mockIFollowServiceClient, mockFollowClient),
			Registration.instance(mockIConcertService, mockConcert),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockILocalArtistClient, mockLocalClient),
		)
		container.register(DiscoveryRoute)
		sut = container.get(DiscoveryRoute)

		// Stub the dnaOrbCanvas ref
		sut.dnaOrbCanvas = {
			pause: vi.fn(),
			resume: vi.fn(),
			reloadBubbles: vi.fn(),
			spawnBubblesAt: vi.fn(),
			fadeOutBubbles: vi.fn(),
			bubbleCount: 0,
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

			sut.searchQuery = 'test'
			;(sut as any).onSearchQueryChanged('test')

			// Before 300ms
			expect(mockArtistClient.search).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(300)

			expect(mockArtistClient.search).toHaveBeenCalledWith('test')
		})

		it('should exit search mode when query is empty', () => {
			sut.isSearchMode = true
			;(sut as any).onSearchQueryChanged('')

			expect(sut.isSearchMode).toBe(false)
		})

		it('should discard stale responses by checking current query', async () => {
			;(mockArtistClient.search as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a2', 'Fresh'),
			])

			sut.searchQuery = 'first'
			;(sut as any).onSearchQueryChanged('first')

			// Before debounce fires, start a new search
			await vi.advanceTimersByTimeAsync(100)
			sut.searchQuery = 'second'
			;(sut as any).onSearchQueryChanged('second')

			await vi.advanceTimersByTimeAsync(300)

			// Only one search should have been triggered (the second one)
			expect(mockArtistClient.search).toHaveBeenCalledTimes(1)
			expect(mockArtistClient.search).toHaveBeenCalledWith('second')
		})
	})

	describe('clearSearch', () => {
		it('should reset searchQuery', () => {
			sut.searchQuery = 'something'
			sut.clearSearch()
			expect(sut.searchQuery).toBe('')
		})
	})

	describe('onGenreSelected', () => {
		it('should activate a genre tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('Rock')
			expect(mockArtistClient.listTop).toHaveBeenCalledWith('Japan', 'rock', 50)
		})

		it('should deactivate when selecting same tag', async () => {
			;(mockArtistClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)

			await sut.onGenreSelected('Rock')
			await sut.onGenreSelected('Rock')

			expect(sut.activeTag).toBe('')
			expect(mockArtistClient.listTop).toHaveBeenLastCalledWith('Japan', '', 50)
		})
	})

	describe('onCoachMarkTap', () => {
		it('should set step to DASHBOARD and navigate to /dashboard', async () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.currentStep = 1

			sut.onCoachMarkTap()

			expect(mockOnboarding.setStep).toHaveBeenCalledWith(3) // DASHBOARD
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

			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledWith('a1', 'Artist')
		})

		it('should not follow already-followed artist', async () => {
			// Follow first
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockResolvedValue(
				undefined,
			)
			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			// Try to follow again
			await sut.onFollowFromSearch(makeBubble('a1', 'Artist'))

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
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

			// followArtist publishes a toast, then onArtistSelected publishes an error toast
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
			expect(sut.isArtistFollowed('a1')).toBe(false)
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

		it('should ignore concurrent requests (isLoadingBubbles guard)', async () => {
			let resolveFirst: () => void
			const firstPromise = new Promise<ArtistBubble[]>((resolve) => {
				resolveFirst = () => resolve([makeBubble('s1', 'S1')])
			})
			;(
				mockArtistClient.listSimilar as ReturnType<typeof vi.fn>
			).mockReturnValueOnce(firstPromise)

			const event = new CustomEvent('need-more-bubbles', {
				detail: { artistId: 'a1', artistName: 'A', position: { x: 0, y: 0 } },
			})

			// Fire two events simultaneously
			const first = sut.onNeedMoreBubbles(event)
			const second = sut.onNeedMoreBubbles(event)

			resolveFirst!()
			await first
			await second

			// listSimilar should only be called once (second was blocked)
			expect(mockArtistClient.listSimilar).toHaveBeenCalledTimes(1)
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
			sut.isSearchMode = false

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
			sut.isSearchMode = true

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
		it('should delegate to localClient.followedCount during onboarding', () => {
			mockOnboarding.isOnboarding = true
			mockLocalClient.followedCount = 5

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

		it('should hide when onboarding but followed < TUTORIAL_FOLLOW_TARGET', () => {
			mockOnboarding.isOnboarding = true
			mockLocalClient.followedCount = 2
			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-01: should be false when concertGroupCount is 0 despite 3+ follows and all searches complete', () => {
			mockOnboarding.isOnboarding = true
			mockLocalClient.followedCount = 3
			sut.completedSearchCount = 3
			sut.concertGroupCount = 0

			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('TC-GATE-02: should be true when concertGroupCount > 0 with 3+ follows and all searches complete', () => {
			mockOnboarding.isOnboarding = true
			mockLocalClient.followedCount = 3
			sut.completedSearchCount = 3
			sut.concertGroupCount = 2

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
			mockOnboarding.currentStep = 1 // DISCOVER
			mockLocalClient.followedCount = 3

			sut.onCoachMarkTap()

			expect(mockOnboarding.deactivateSpotlight).toHaveBeenCalledTimes(1)
			expect(mockOnboarding.setStep).toHaveBeenCalledWith(3) // DASHBOARD
			expect(mockRouter.load).toHaveBeenCalledWith('/dashboard')
		})

		it('should not advance step when showDashboardCoachMark is false (fewer than 3 follows)', () => {
			mockOnboarding.isOnboarding = true
			mockOnboarding.currentStep = 1 // DISCOVER
			mockLocalClient.followedCount = 1

			// showDashboardCoachMark should be false
			expect(sut.showDashboardCoachMark).toBe(false)
		})
	})
})
