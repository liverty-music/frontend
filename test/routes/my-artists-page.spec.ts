import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { createTestContainer } from '../helpers/create-container'

const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
vi.mock('../../src/services/follow-service-client', () => ({
	IFollowServiceClient: mockIFollowServiceClient,
}))

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
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

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js',
	() => ({
		ArtistId: class ArtistId {
			value: string
			constructor(opts: { value: string }) {
				this.value = opts.value
			}
		},
		HypeType: { ANYWHERE: 1, HOME: 2, WATCH: 3 },
	}),
)

const { MyArtistsPage } = await import(
	'../../src/routes/my-artists/my-artists-page'
)

function makeFollowedArtistInfo(id: string, name: string, hype = 2) {
	return { id, name, hype }
}

function makeTouchEvent(clientX: number, clientY = 0): TouchEvent {
	return {
		touches: [{ clientX, clientY }],
		preventDefault: vi.fn(),
	} as unknown as TouchEvent
}

describe('MyArtistsPage', () => {
	let sut: InstanceType<typeof MyArtistsPage>
	let ea: IEventAggregator
	let mockGrpcClient: {
		unfollow: ReturnType<typeof vi.fn>
		setHype: ReturnType<typeof vi.fn>
	}
	let mockFollowService: {
		listFollowed: ReturnType<typeof vi.fn>
		getClient: () => typeof mockGrpcClient
	}
	let mockRouter: { load: ReturnType<typeof vi.fn> }
	let publishedToasts: Toast[]

	beforeEach(() => {
		mockGrpcClient = {
			unfollow: vi.fn().mockResolvedValue({}),
			setHype: vi.fn().mockResolvedValue({}),
		}

		mockFollowService = {
			listFollowed: vi
				.fn()
				.mockResolvedValue([
					makeFollowedArtistInfo('id-1', 'RADWIMPS'),
					makeFollowedArtistInfo('id-2', 'ONE OK ROCK'),
					makeFollowedArtistInfo('id-3', 'Aimer'),
				]),
			getClient: () => mockGrpcClient,
		}
		mockRouter = { load: vi.fn().mockResolvedValue(undefined) }

		const mockOnboarding = {
			currentStep: 7, // COMPLETED
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
		}

		const container = createTestContainer(
			Registration.instance(mockIFollowServiceClient, mockFollowService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
		)
		container.register(MyArtistsPage)
		sut = container.get(MyArtistsPage)
		ea = container.get(IEventAggregator)

		// Capture published Toast events
		publishedToasts = []
		ea.subscribe(Toast, (toast: Toast) => {
			publishedToasts.push(toast)
		})

		// Mock dialog elements for Top Layer API
		for (const name of [
			'contextMenuDialog',
			'hypeSelectorDialog',
			'hypeExplanationDialog',
		]) {
			const mockDialog = document.createElement('dialog')
			;(mockDialog as any).showModal = vi.fn()
			;(mockDialog as any).close = vi.fn()
			;(sut as any)[name] = mockDialog
		}
	})

	describe('loading', () => {
		it('should fetch and populate followed artists', async () => {
			await sut.loading()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[0].name).toBe('RADWIMPS')
			expect(sut.artists[0].id).toBe('id-1')
			expect(sut.artists[0].color).toMatch(/^hsl\(/)
		})

		it('should handle empty response', async () => {
			mockFollowService.listFollowed.mockResolvedValue([])
			await sut.loading()

			expect(sut.artists).toHaveLength(0)
			expect(sut.isLoading).toBe(false)
		})

		it('should handle RPC errors gracefully', async () => {
			mockFollowService.listFollowed.mockRejectedValue(
				new Error('Network error'),
			)
			await sut.loading()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(0)
		})
	})

	describe('swipe-to-unfollow', () => {
		beforeEach(async () => {
			await sut.loading()
		})

		it('should track swipe offset on left swipe', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180)) // -20 deltaX, triggers swiping
			sut.onTouchMove(makeTouchEvent(100)) // -100 deltaX

			expect(sut.swipedArtistId).toBe('id-1')
			expect(sut.swipeOffset).toBe(-100)
		})

		it('should not track right swipe', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(120))

			// Right swipe — offset clamped to 0
			expect(sut.swipeOffset).toBe(0)
		})

		it('should cancel swipe on vertical scroll', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200, 100))
			sut.onTouchMove(makeTouchEvent(200, 120)) // 20px vertical, triggers scroll cancel

			expect(sut.swipedArtistId).toBe('')
		})

		it('should unfollow when swipe exceeds threshold', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100)) // -100 > threshold
			sut.onTouchEnd()

			expect(sut.artists).toHaveLength(2)
			expect(publishedToasts).toHaveLength(1)
			expect(publishedToasts[0].action).toBeDefined()
			expect(publishedToasts[0].action?.label).toBe('myArtists.undo')
		})

		it('should not unfollow when swipe is below threshold', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(190))
			sut.onTouchMove(makeTouchEvent(170)) // -30 < threshold
			sut.onTouchEnd()

			expect(sut.artists).toHaveLength(3)
			expect(publishedToasts).toHaveLength(0)
		})

		it('should reset swipe state after touchend', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchEnd()

			expect(sut.swipeOffset).toBe(0)
			expect(sut.swipedArtistId).toBe('')
		})
	})

	describe('long-press unfollow', () => {
		beforeEach(async () => {
			vi.useFakeTimers()
			await sut.loading()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it('should unfollow after long press', () => {
			sut.onTouchStart(sut.artists[1], makeTouchEvent(100))
			vi.advanceTimersByTime(500)

			expect(sut.artists).toHaveLength(2)
			expect(publishedToasts).toHaveLength(1)
		})

		it('should cancel long press on touch move', () => {
			sut.onTouchStart(sut.artists[1], makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(80))
			vi.advanceTimersByTime(500)

			// long-press cancelled by movement, but swipe threshold not met
			expect(sut.artists).toHaveLength(3)
		})
	})

	describe('undo', () => {
		beforeEach(async () => {
			vi.useFakeTimers()
			await sut.loading()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it('should re-insert artist at original position', () => {
			// Remove the second artist
			sut.onTouchStart(sut.artists[1], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			expect(sut.artists).toHaveLength(2)
			expect(sut.artists[1].name).toBe('Aimer')

			// Invoke the undo action callback from the published toast
			publishedToasts[0].action?.callback()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].name).toBe('ONE OK ROCK')
		})

		it('should commit unfollow RPC when toast is dismissed', async () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			// Simulate toast dismiss via onDismiss callback
			publishedToasts[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockGrpcClient.unfollow).toHaveBeenCalledWith({
				artistId: expect.objectContaining({ value: 'id-1' }),
			})
		})

		it('should not call RPC when undo is pressed before dismiss', async () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			// Undo first (clears undoArtist), then onDismiss fires
			publishedToasts[0].action?.callback()
			publishedToasts[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockGrpcClient.unfollow).not.toHaveBeenCalled()
		})
	})

	describe('goToDiscover', () => {
		it('should navigate to discover page', async () => {
			await sut.goToDiscover()
			expect(mockRouter.load).toHaveBeenCalledWith('discover')
		})
	})

	describe('detaching', () => {
		it('should clean up timers and abort controller', async () => {
			await sut.loading()
			sut.detaching()
			// No errors thrown, cleanup completed
			expect(sut.isLoading).toBe(false)
		})
	})

	describe('tutorial step 5 hype timing', () => {
		let tutorialSut: InstanceType<typeof MyArtistsPage>

		beforeEach(async () => {
			vi.useFakeTimers()

			const mockOnboarding = {
				currentStep: 5, // MY_ARTISTS
				isOnboarding: true,
				isCompleted: false,
				setStep: vi.fn(),
				complete: vi.fn(),
			}

			const container = createTestContainer(
				Registration.instance(mockIFollowServiceClient, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, mockOnboarding),
				Registration.instance(IEventAggregator, { publish: vi.fn() }),
			)
			container.register(MyArtistsPage)
			tutorialSut = container.get(MyArtistsPage)

			for (const name of [
				'contextMenuDialog',
				'hypeSelectorDialog',
				'hypeExplanationDialog',
			]) {
				const mockDialog = document.createElement('dialog')
				;(mockDialog as any).showModal = vi.fn()
				;(mockDialog as any).close = vi.fn()
				;(tutorialSut as any)[name] = mockDialog
			}

			await tutorialSut.loading()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it('should set pulsingArtistId immediately on hype change', () => {
			tutorialSut.openHypeSelector(tutorialSut.artists[0])
			tutorialSut.selectHype(1) // ANYWHERE

			expect(tutorialSut.pulsingArtistId).toBe('id-1')
		})

		it('should clear pulsingArtistId after 300ms', () => {
			tutorialSut.openHypeSelector(tutorialSut.artists[0])
			tutorialSut.selectHype(1)

			vi.advanceTimersByTime(300)
			expect(tutorialSut.pulsingArtistId).toBe('')
		})

		it('should use 800ms delay for hype explanation', () => {
			tutorialSut.openHypeSelector(tutorialSut.artists[0])
			tutorialSut.selectHype(1)

			// At 700ms, explanation should still be showing
			vi.advanceTimersByTime(700)
			expect(tutorialSut.showHypeExplanation).toBe(true)

			// At 800ms, explanation should close
			vi.advanceTimersByTime(100)
			expect(tutorialSut.showHypeExplanation).toBe(false)
		})
	})
})
