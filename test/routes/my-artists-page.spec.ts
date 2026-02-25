import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIArtistServiceClient = DI.createInterface('IArtistServiceClient')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIToastService = DI.createInterface('IToastService')

vi.mock('../../src/services/artist-service-client', () => ({
	IArtistServiceClient: mockIArtistServiceClient,
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

vi.mock('../../src/components/toast-notification/toast-notification', () => ({
	IToastService: mockIToastService,
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
		PassionLevel: { MUST_GO: 1, LOCAL_ONLY: 2, KEEP_AN_EYE: 3 },
	}),
)

const { MyArtistsPage } = await import(
	'../../src/routes/my-artists/my-artists-page'
)

function makeFollowedArtistInfo(id: string, name: string, passionLevel = 2) {
	return { id, name, passionLevel }
}

function makeTouchEvent(clientX: number, clientY = 0): TouchEvent {
	return {
		touches: [{ clientX, clientY }],
		preventDefault: vi.fn(),
	} as unknown as TouchEvent
}

describe('MyArtistsPage', () => {
	let sut: InstanceType<typeof MyArtistsPage>
	let mockGrpcClient: {
		unfollow: ReturnType<typeof vi.fn>
		setPassionLevel: ReturnType<typeof vi.fn>
	}
	let mockArtistService: {
		listFollowed: ReturnType<typeof vi.fn>
		getClient: () => typeof mockGrpcClient
	}
	let mockRouter: { load: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockGrpcClient = {
			unfollow: vi.fn().mockResolvedValue({}),
			setPassionLevel: vi.fn().mockResolvedValue({}),
		}

		mockArtistService = {
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

		const mockToast = { show: vi.fn() }

		const container = createTestContainer(
			Registration.instance(mockIArtistServiceClient, mockArtistService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIToastService, mockToast),
		)
		container.register(MyArtistsPage)
		sut = container.get(MyArtistsPage)
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
			mockArtistService.listFollowed.mockResolvedValue([])
			await sut.loading()

			expect(sut.artists).toHaveLength(0)
			expect(sut.isLoading).toBe(false)
		})

		it('should handle RPC errors gracefully', async () => {
			mockArtistService.listFollowed.mockRejectedValue(
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
			expect(sut.undoVisible).toBe(true)
			expect(sut.undoArtist?.name).toBe('RADWIMPS')
		})

		it('should not unfollow when swipe is below threshold', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(190))
			sut.onTouchMove(makeTouchEvent(170)) // -30 < threshold
			sut.onTouchEnd()

			expect(sut.artists).toHaveLength(3)
			expect(sut.undoVisible).toBe(false)
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

		it('should unfollow after long press', () => {
			sut.onTouchStart(sut.artists[1], makeTouchEvent(100))
			vi.advanceTimersByTime(500)

			expect(sut.artists).toHaveLength(2)
			expect(sut.undoArtist?.name).toBe('ONE OK ROCK')

			vi.useRealTimers()
		})

		it('should cancel long press on touch move', () => {
			sut.onTouchStart(sut.artists[1], makeTouchEvent(100))
			sut.onTouchMove(makeTouchEvent(80))
			vi.advanceTimersByTime(500)

			// long-press cancelled by movement, but swipe threshold not met
			expect(sut.artists).toHaveLength(3)

			vi.useRealTimers()
		})
	})

	describe('undo', () => {
		beforeEach(async () => {
			vi.useFakeTimers()
			await sut.loading()
		})

		it('should re-insert artist at original position', () => {
			// Remove the second artist
			sut.onTouchStart(sut.artists[1], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			expect(sut.artists).toHaveLength(2)
			expect(sut.artists[1].name).toBe('Aimer')

			sut.undo()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].name).toBe('ONE OK ROCK')
			expect(sut.undoVisible).toBe(false)

			vi.useRealTimers()
		})

		it('should commit unfollow RPC after undo timer expires', async () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			vi.advanceTimersByTime(5000)
			await vi.runAllTimersAsync()

			expect(mockGrpcClient.unfollow).toHaveBeenCalledWith({
				artistId: expect.objectContaining({ value: 'id-1' }),
			})
			expect(sut.undoVisible).toBe(false)

			vi.useRealTimers()
		})

		it('should not call RPC when undo is pressed', () => {
			sut.onTouchStart(sut.artists[0], makeTouchEvent(200))
			sut.onTouchMove(makeTouchEvent(180))
			sut.onTouchMove(makeTouchEvent(100))
			sut.onTouchEnd()

			sut.undo()
			vi.advanceTimersByTime(5000)

			expect(mockGrpcClient.unfollow).not.toHaveBeenCalled()

			vi.useRealTimers()
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
})
