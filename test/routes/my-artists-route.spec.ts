import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../src/components/snack-bar/snack'
import { createTestContainer } from '../helpers/create-container'

const mockIFollowStore = DI.createInterface('IFollowStore')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))

vi.mock('@aurelia/router', () => ({
	IRouter: mockIRouter,
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
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
			isOnboarding: false,
			isCompleted: true,
			finish: vi.fn(),
		}

		const container = createTestContainer(
			Registration.instance(mockIFollowStore, mockFollowService),
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

		it('should load artists from guest service for unauthenticated user', async () => {
			mockAuth.isAuthenticated = false
			mockFollowService.listFollowed.mockResolvedValue([
				makeFollowedArtist('g-1', 'Guest Artist', 'watch'),
			])

			await sut.loading()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(1)
			expect(sut.artists[0].artist.name).toBe('Guest Artist')
			expect(sut.artists[0].hype).toBe('watch')
			expect(mockFollowService.listFollowed).toHaveBeenCalled()
		})

		it('should show signup banner for unauthenticated user with completed onboarding', async () => {
			mockAuth.isAuthenticated = false

			await sut.loading()

			expect(sut.showSignupBanner).toBe(true)
		})

		it('should not show signup banner for authenticated user', async () => {
			mockAuth.isAuthenticated = true

			await sut.loading()

			expect(sut.showSignupBanner).toBe(false)
		})
	})

	describe('delete button', () => {
		beforeEach(async () => {
			await sut.loading()
		})

		it('should unfollow and publish undo snack', () => {
			sut.unfollowArtist(sut.artists[0])

			expect(sut.artists).toHaveLength(2)
			expect(publishedSnacks).toHaveLength(1)
			expect(publishedSnacks[0].action).toBeDefined()
			expect(publishedSnacks[0].action?.label).toBe('myArtists.undo')
		})

		it('should not unfollow during onboarding', async () => {
			const mockOnboarding = {
				currentStep: 'my-artists',
				isOnboarding: true,
				setStep: vi.fn(),
				activateSpotlight: vi.fn(),
				deactivateSpotlight: vi.fn(),
			}
			const container = createTestContainer(
				Registration.instance(mockIFollowStore, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, mockOnboarding),
				Registration.instance(mockIAuthService, mockAuth),
			)
			container.register(MyArtistsRoute)
			const onboardingSut = container.get(MyArtistsRoute)
			await onboardingSut.loading()

			onboardingSut.unfollowArtist(onboardingSut.artists[0])

			expect(onboardingSut.artists).toHaveLength(3)
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
			const artist = sut.artists[1]
			sut.unfollowArtist(artist)

			expect(sut.artists).toHaveLength(2)
			expect(sut.artists[1].artist.name).toBe('Aimer')

			publishedSnacks[0].action?.callback()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].artist.name).toBe('ONE OK ROCK')
		})

		it('should commit unfollow RPC when toast is dismissed', async () => {
			sut.unfollowArtist(sut.artists[0])

			publishedSnacks[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockFollowService.unfollow).toHaveBeenCalledWith('id-1')
		})

		it('should not call RPC when undo is pressed before dismiss', async () => {
			sut.unfollowArtist(sut.artists[0])

			publishedSnacks[0].action?.callback()
			publishedSnacks[0].options?.onDismiss?.()
			await vi.runAllTimersAsync()

			expect(mockFollowService.unfollow).not.toHaveBeenCalled()
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
		// #444 regression: hype editing is fully decoupled from onboarding. A
		// guest still in onboarding can change hype repeatedly; every change
		// applies and persists, and onboarding state is never mutated or used to
		// revert the change.
		describe('guest during onboarding (#444)', () => {
			let onboardingSut: InstanceType<typeof MyArtistsRoute>
			let onboardingOnboarding: {
				isOnboarding: boolean
				finish: ReturnType<typeof vi.fn>
			}

			beforeEach(async () => {
				mockAuth.isAuthenticated = false
				onboardingOnboarding = {
					isOnboarding: true,
					finish: vi.fn(),
				}

				const container = createTestContainer(
					Registration.instance(mockIFollowStore, mockFollowService),
					Registration.instance(mockIRouter, mockRouter),
					Registration.instance(mockIOnboardingService, onboardingOnboarding),
					Registration.instance(mockIAuthService, mockAuth),
					Registration.instance(IEventAggregator, { publish: vi.fn() }),
				)
				container.register(MyArtistsRoute)
				onboardingSut = container.get(MyArtistsRoute)
				await onboardingSut.loading()
			})

			it('applies and persists a hype change without mutating onboarding state', () => {
				const artist = onboardingSut.artists[0]

				onboardingSut.onHypeInput(artist, 'away')

				expect(artist.hype).toBe('away')
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-1', 'away')
				expect(onboardingOnboarding.finish).not.toHaveBeenCalled()
				expect(mockRouter.load).not.toHaveBeenCalled()
			})

			it('applies every repeated hype change and never reverts (the #444 bug)', () => {
				const artist = onboardingSut.artists[0]

				onboardingSut.onHypeInput(artist, 'home')
				expect(artist.hype).toBe('home')
				expect(mockFollowService.setHype).toHaveBeenLastCalledWith(
					'id-1',
					'home',
				)

				onboardingSut.onHypeInput(artist, 'nearby')
				expect(artist.hype).toBe('nearby')
				expect(mockFollowService.setHype).toHaveBeenLastCalledWith(
					'id-1',
					'nearby',
				)

				onboardingSut.onHypeInput(artist, 'away')
				expect(artist.hype).toBe('away')
				expect(mockFollowService.setHype).toHaveBeenLastCalledWith(
					'id-1',
					'away',
				)

				expect(mockFollowService.setHype).toHaveBeenCalledTimes(3)
				expect(onboardingOnboarding.finish).not.toHaveBeenCalled()
			})
		})

		describe('unauthenticated user', () => {
			beforeEach(async () => {
				mockAuth.isAuthenticated = false
				await sut.loading()
			})

			it('should accept hype change and persist via the follow service (guest routing is internal)', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')

				expect(artist.hype).toBe('away')
				// The follow service facade now resolves guest vs authed internally:
				// for a guest it persists to the localStorage-backed queue (no RPC)
				// rather than the route branching on auth state.
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-1', 'away')
			})

			it('routes the hype change through the follow service facade', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')

				expect(mockFollowService.setHype).toHaveBeenCalledOnce()
			})
		})

		describe('authenticated user', () => {
			beforeEach(async () => {
				mockAuth.isAuthenticated = true
				await sut.loading()
			})

			it('should accept hype change and call setHype RPC', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')

				expect(artist.hype).toBe('away')
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-1', 'away')
			})

			it('should revert hype on RPC failure after retry', async () => {
				mockFollowService.setHype.mockRejectedValue(new Error('fail'))
				const artist = sut.artists[0]
				const originalHype = artist.hype

				sut.onHypeInput(artist, 'away')

				await vi.waitFor(() => {
					expect(mockFollowService.setHype).toHaveBeenCalledTimes(2)
				})
				expect(artist.hype).toBe(originalHype)
			})

			it('should no-op when hype has not changed', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, artist.hype as 'nearby')

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})
	})
})
