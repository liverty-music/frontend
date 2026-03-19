import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../src/components/snack-bar/snack'
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
		LP: 'lp',
		DISCOVERY: 'discovery',
		DASHBOARD: 'dashboard',
		DETAIL: 'detail',
		MY_ARTISTS: 'my-artists',
		COMPLETED: 'completed',
	},
}))

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { MyArtistsRoute } = await import(
	'../../src/routes/my-artists/my-artists-route'
)

function makeFollowedArtist(id: string, name: string, hype = 'nearby') {
	return {
		artist: { id, name, mbid: '' },
		hype,
	}
}

describe('MyArtistsRoute', () => {
	let sut: InstanceType<typeof MyArtistsRoute>
	let ea: IEventAggregator
	let mockFollowService: {
		listFollowed: ReturnType<typeof vi.fn>
		unfollow: ReturnType<typeof vi.fn>
		setHype: ReturnType<typeof vi.fn>
	}
	let mockRouter: { load: ReturnType<typeof vi.fn> }
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
	let publishedSnacks: Snack[]

	beforeEach(() => {
		mockFollowService = {
			listFollowed: vi
				.fn()
				.mockResolvedValue([
					makeFollowedArtist('id-1', 'RADWIMPS'),
					makeFollowedArtist('id-2', 'ONE OK ROCK'),
					makeFollowedArtist('id-3', 'Aimer'),
				]),
			unfollow: vi.fn().mockResolvedValue(undefined),
			setHype: vi.fn().mockResolvedValue(undefined),
		}
		mockRouter = { load: vi.fn().mockResolvedValue(undefined) }
		mockAuth = { isAuthenticated: true, signUp: vi.fn() }

		const mockOnboarding = {
			currentStep: 'completed', // COMPLETED
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
		container.register(MyArtistsRoute)
		sut = container.get(MyArtistsRoute)
		ea = container.get(IEventAggregator)

		// Capture published Snack events
		publishedSnacks = []
		ea.subscribe(Snack, (snack: Snack) => {
			publishedSnacks.push(snack)
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
			expect(sut.artists[0].artist.name).toBe('RADWIMPS')
			expect(sut.artists[0].artist.id).toBe('id-1')
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

		function makeScrollEvent(
			scrollLeft: number,
			offsetWidth: number,
			scrollWidth: number,
		): Event {
			return {
				target: { scrollLeft, offsetWidth, scrollWidth },
			} as unknown as Event
		}

		it('should unfollow when scroll exceeds 50% threshold', () => {
			sut.checkDismiss(makeScrollEvent(50, 400, 480), sut.artists[0])

			expect(sut.artists).toHaveLength(2)
			expect(publishedSnacks).toHaveLength(1)
			expect(publishedSnacks[0].action).toBeDefined()
			expect(publishedSnacks[0].action?.label).toBe('myArtists.undo')
		})

		it('should not unfollow when scroll is below threshold', () => {
			sut.checkDismiss(makeScrollEvent(30, 400, 480), sut.artists[0])

			expect(sut.artists).toHaveLength(3)
			expect(publishedSnacks).toHaveLength(0)
		})

		it('should not dismiss twice for the same artist', () => {
			const artist = sut.artists[0]
			sut.checkDismiss(makeScrollEvent(50, 400, 480), artist)
			sut.checkDismiss(makeScrollEvent(50, 400, 480), artist)

			expect(publishedSnacks).toHaveLength(1)
		})
	})

	describe('undo', () => {
		function makeScrollEvent(
			scrollLeft: number,
			offsetWidth: number,
			scrollWidth: number,
		): Event {
			return {
				target: { scrollLeft, offsetWidth, scrollWidth },
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
			sut.checkDismiss(makeScrollEvent(50, 400, 480), artist)

			expect(sut.artists).toHaveLength(2)
			expect(sut.artists[1].artist.name).toBe('Aimer')

			publishedSnacks[0].action?.callback()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].artist.name).toBe('ONE OK ROCK')
		})

		it('should commit unfollow RPC when toast is dismissed', async () => {
			sut.checkDismiss(makeScrollEvent(50, 400, 480), sut.artists[0])

			publishedSnacks[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockFollowService.unfollow).toHaveBeenCalledWith('id-1')
		})

		it('should not call RPC when undo is pressed before dismiss', async () => {
			sut.checkDismiss(makeScrollEvent(50, 400, 480), sut.artists[0])

			publishedSnacks[0].action?.callback()
			publishedSnacks[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockFollowService.unfollow).not.toHaveBeenCalled()
		})
	})

	describe('goToDiscovery', () => {
		it('should navigate to discovery page', async () => {
			await sut.goToDiscovery()
			expect(mockRouter.load).toHaveBeenCalledWith('discovery')
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

	describe('onHypeInput', () => {
		describe('onboarding step my-artists', () => {
			let onboardingSut: InstanceType<typeof MyArtistsRoute>
			let onboardingOnboarding: any

			beforeEach(async () => {
				onboardingOnboarding = {
					currentStep: 'my-artists',
					isOnboarding: true,
					setStep: vi.fn(),
					activateSpotlight: vi.fn(),
					deactivateSpotlight: vi.fn(),
				}

				const container = createTestContainer(
					Registration.instance(mockIFollowServiceClient, mockFollowService),
					Registration.instance(mockIRouter, mockRouter),
					Registration.instance(mockIOnboardingService, onboardingOnboarding),
					Registration.instance(mockIAuthService, mockAuth),
					Registration.instance(IEventAggregator, { publish: vi.fn() }),
				)
				container.register(MyArtistsRoute)
				onboardingSut = container.get(MyArtistsRoute)
				await onboardingSut.loading()
			})

			it('should activate spotlight targeting .artist-list on loading', () => {
				expect(onboardingOnboarding.activateSpotlight).toHaveBeenCalledWith(
					'.artist-list',
					expect.any(String),
					expect.any(Function),
				)
			})

			it('should revert hype, complete onboarding, and redirect', () => {
				const artist = onboardingSut.artists[0]
				const originalHype = artist.hype
				artist.hype = 'away'

				onboardingSut.onHypeInput(artist)

				expect(artist.hype).toBe(originalHype)
				expect(onboardingOnboarding.deactivateSpotlight).toHaveBeenCalled()
				expect(onboardingOnboarding.setStep).toHaveBeenCalledWith('completed')
				expect(mockRouter.load).toHaveBeenCalledWith('')
			})

			it('should not call setHype RPC', () => {
				const artist = onboardingSut.artists[0]
				artist.hype = 'away'

				onboardingSut.onHypeInput(artist)

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})

		describe('unauthenticated user', () => {
			beforeEach(async () => {
				mockAuth.isAuthenticated = false
				await sut.loading()
			})

			it('should revert hype and show notification dialog', () => {
				const artist = sut.artists[0]
				const originalHype = artist.hype
				artist.hype = 'away'

				sut.onHypeInput(artist)

				expect(artist.hype).toBe(originalHype)
				expect(sut.showNotificationDialog).toBe(true)
			})

			it('should not show dialog if already shown', () => {
				sut.notificationDialogShown = true
				const artist = sut.artists[0]
				artist.hype = 'away'

				sut.onHypeInput(artist)

				expect(sut.showNotificationDialog).toBe(false)
			})

			it('should not call setHype RPC', () => {
				const artist = sut.artists[0]
				artist.hype = 'away'

				sut.onHypeInput(artist)

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})

		describe('authenticated user', () => {
			beforeEach(async () => {
				mockAuth.isAuthenticated = true
				await sut.loading()
			})

			it('should accept hype change and call setHype RPC', () => {
				const artist = sut.artists[0]
				artist.hype = 'away'

				sut.onHypeInput(artist)

				expect(artist.hype).toBe('away')
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-1', 'away')
			})

			it('should revert hype on RPC failure after retry', async () => {
				mockFollowService.setHype.mockRejectedValue(new Error('fail'))
				const artist = sut.artists[0]
				const originalHype = artist.hype
				artist.hype = 'away'

				sut.onHypeInput(artist)

				await vi.waitFor(() => {
					expect(mockFollowService.setHype).toHaveBeenCalledTimes(2)
				})
				expect(artist.hype).toBe(originalHype)
			})

			it('should no-op when hype has not changed', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist)

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})
	})
})
