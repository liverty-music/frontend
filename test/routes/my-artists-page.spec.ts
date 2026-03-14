import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'
import { createTestContainer } from '../helpers/create-container'

const mockIFollowServiceClient = DI.createInterface('IFollowServiceClient')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIAuthService = DI.createInterface('IAuthService')
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

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
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
	}),
)

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js',
	() => ({
		HypeType: { WATCH: 1, HOME: 2, NEARBY: 3, AWAY: 4 },
	}),
)

const { MyArtistsPage } = await import(
	'../../src/routes/my-artists/my-artists-page'
)

function makeFollowedArtistInfo(id: string, name: string, hype = 2) {
	return { id, name, hype }
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
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
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
		mockAuth = { isAuthenticated: true, signUp: vi.fn() }

		const mockOnboarding = {
			currentStep: 7, // COMPLETED
			isOnboarding: false,
			setStep: vi.fn(),
			complete: vi.fn(),
			activateSpotlight: vi.fn(),
			deactivateSpotlight: vi.fn(),
		}

		const container = createTestContainer(
			Registration.instance(mockIFollowServiceClient, mockFollowService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIAuthService, mockAuth),
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

	describe('scroll-snap dismiss', () => {
		beforeEach(async () => {
			await sut.loading()
		})

		function makeScrollEvent(scrollLeft: number, offsetWidth: number): Event {
			return {
				target: { scrollLeft, offsetWidth },
			} as unknown as Event
		}

		it('should unfollow when scroll exceeds 50% threshold', () => {
			sut.checkDismiss(makeScrollEvent(210, 400), sut.artists[0])

			expect(sut.artists).toHaveLength(2)
			expect(publishedToasts).toHaveLength(1)
			expect(publishedToasts[0].action).toBeDefined()
			expect(publishedToasts[0].action?.label).toBe('myArtists.undo')
		})

		it('should not unfollow when scroll is below threshold', () => {
			sut.checkDismiss(makeScrollEvent(100, 400), sut.artists[0])

			expect(sut.artists).toHaveLength(3)
			expect(publishedToasts).toHaveLength(0)
		})

		it('should not dismiss twice for the same artist', () => {
			const artist = sut.artists[0]
			sut.checkDismiss(makeScrollEvent(210, 400), artist)
			sut.checkDismiss(makeScrollEvent(210, 400), artist)

			expect(publishedToasts).toHaveLength(1)
		})
	})

	describe('undo', () => {
		function makeScrollEvent(scrollLeft: number, offsetWidth: number): Event {
			return {
				target: { scrollLeft, offsetWidth },
			} as unknown as Event
		}

		beforeEach(async () => {
			vi.useFakeTimers()
			await sut.loading()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it('should re-insert artist at original position', () => {
			const artist = sut.artists[1]
			sut.checkDismiss(makeScrollEvent(210, 400), artist)

			expect(sut.artists).toHaveLength(2)
			expect(sut.artists[1].name).toBe('Aimer')

			publishedToasts[0].action?.callback()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].name).toBe('ONE OK ROCK')
		})

		it('should commit unfollow RPC when toast is dismissed', async () => {
			sut.checkDismiss(makeScrollEvent(210, 400), sut.artists[0])

			publishedToasts[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockGrpcClient.unfollow).toHaveBeenCalledWith({
				artistId: expect.objectContaining({ value: 'id-1' }),
			})
		})

		it('should not call RPC when undo is pressed before dismiss', async () => {
			sut.checkDismiss(makeScrollEvent(210, 400), sut.artists[0])

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

	describe('tutorial step 5 hype flow', () => {
		let tutorialSut: InstanceType<typeof MyArtistsPage>
		let tutorialOnboarding: any

		beforeEach(async () => {
			vi.useFakeTimers()

			tutorialOnboarding = {
				currentStep: 5, // MY_ARTISTS
				isOnboarding: true,
				isCompleted: false,
				setStep: vi.fn(),
				complete: vi.fn(),
				activateSpotlight: vi.fn(),
				deactivateSpotlight: vi.fn(),
			} as any

			const container = createTestContainer(
				Registration.instance(mockIFollowServiceClient, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, tutorialOnboarding),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IEventAggregator, { publish: vi.fn() }),
			)
			container.register(MyArtistsPage)
			tutorialSut = container.get(MyArtistsPage)

			for (const name of ['contextMenuDialog']) {
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

		it('should activate spotlight targeting [data-hype-header] on loading', () => {
			expect(tutorialOnboarding.activateSpotlight).toHaveBeenCalledWith(
				'[data-hype-header]',
				expect.any(String),
			)
		})

		it('should set pulsingArtistId immediately on hype change', () => {
			const event = new CustomEvent('hype-changed', {
				detail: { artistId: 'id-1', level: 'away' },
			})

			tutorialSut.onHypeChanged(event)

			expect(tutorialSut.pulsingArtistId).toBe('id-1')
		})

		it('should clear pulsingArtistId after 300ms', () => {
			const event = new CustomEvent('hype-changed', {
				detail: { artistId: 'id-1', level: 'away' },
			})

			tutorialSut.onHypeChanged(event)

			vi.advanceTimersByTime(300)
			expect(tutorialSut.pulsingArtistId).toBe('')
		})

		it('should advance to step 7 (COMPLETED), not 6, after hype change', () => {
			const event = new CustomEvent('hype-changed', {
				detail: { artistId: 'id-1', level: 'away' },
			})

			tutorialSut.onHypeChanged(event)

			// Step 6 (SIGNUP) was removed; should go directly to COMPLETED (7)
			expect(tutorialOnboarding.setStep).toHaveBeenCalledWith(7)
			expect(tutorialOnboarding.deactivateSpotlight).toHaveBeenCalled()
			expect(mockRouter.load).toHaveBeenCalledWith('')
		})
	})
})
