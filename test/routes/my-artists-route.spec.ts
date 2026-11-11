import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import { createTestContainer } from '../helpers/create-container'

const mockIFollowStore = DI.createInterface('IFollowStore')
const mockIRouter = DI.createInterface('IRouter')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))

// The real module (other code imports its IRouterEvents) with IRouter
// swapped; the getter defers the read past this hoisted factory.
vi.mock('@aurelia/router', async (importOriginal) => ({
	...(await importOriginal<typeof import('@aurelia/router')>()),
	get IRouter() {
		return mockIRouter
	},
}))

vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
}))

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

// The home decision and save belong to the user store; every container of
// this file resolves this stand-in by default.
const mockUserStore = {
	needsHome: false,
	currentHome: 'JP-13' as string | null,
	saveHome: vi.fn(async (code: string) => {
		mockUserStore.needsHome = false
		mockUserStore.currentHome = code
	}),
}
vi.mock('../../src/services/user-store', () => ({
	IUserStore: DI.createInterface('IUserStore', (x) =>
		x.instance(mockUserStore),
	),
}))

const { MyArtistsRoute } = await import(
	'../../src/routes/my-artists/my-artists-route'
)
const { IPushOfferService } = await import(
	'../../src/services/push-offer-service'
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
	let pushOffer: {
		pushState: ReturnType<typeof vi.fn>
		accept: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		mockUserStore.needsHome = false
		mockUserStore.currentHome = 'JP-13'
		mockUserStore.saveHome.mockClear()
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

		pushOffer = {
			pushState: vi.fn(async () => 'offerable'),
			accept: vi.fn(async () => 'granted'),
		}
		localStorage.clear()

		const container = createTestContainer(
			Registration.instance(mockIFollowStore, mockFollowService),
			Registration.instance(mockIRouter, mockRouter),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(IPushOfferService, pushOffer),
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

	describe('loadArtists', () => {
		it('should fetch and populate followed artists', async () => {
			await sut.loadArtists()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[0].artist.name).toBe('RADWIMPS')
			expect(sut.artists[0].artist.id).toBe('id-1')
			expect(sut.artists[0].color).toMatch(/^hsl\(/)
		})

		it('should handle empty response', async () => {
			mockFollowService.listFollowed.mockResolvedValue([])
			await sut.loadArtists()

			expect(sut.artists).toHaveLength(0)
			expect(sut.isLoading).toBe(false)
		})

		it('should handle RPC errors gracefully', async () => {
			mockFollowService.listFollowed.mockRejectedValue(
				new Error('Network error'),
			)
			await sut.loadArtists()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(0)
		})

		it('should load artists from guest service for unauthenticated user', async () => {
			mockAuth.isAuthenticated = false
			mockFollowService.listFollowed.mockResolvedValue([
				makeFollowedArtist('g-1', 'Guest Artist', 'watch'),
			])

			await sut.loadArtists()

			expect(sut.isLoading).toBe(false)
			expect(sut.artists).toHaveLength(1)
			expect(sut.artists[0].artist.name).toBe('Guest Artist')
			expect(sut.artists[0].hype).toBe('watch')
			expect(mockFollowService.listFollowed).toHaveBeenCalled()
		})
	})

	describe('loading', () => {
		it('is non-blocking: resolves before the fetch settles, isLoading true at attach', async () => {
			let resolveFetch: (v: unknown[]) => void = () => {}
			mockFollowService.listFollowed.mockReturnValue(
				new Promise((r) => {
					resolveFetch = r
				}),
			)

			await sut.loading()

			// loading() resolved even though the fetch is still pending, so the
			// view attaches immediately with the spinner visible.
			expect(sut.isLoading).toBe(true)
			expect(sut.artists).toHaveLength(0)

			resolveFetch([makeFollowedArtist('id-1', 'RADWIMPS')])
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

	describe('home sheet for a person without a home', () => {
		function withOnboarding(isOnboarding: boolean) {
			const container = createTestContainer(
				Registration.instance(mockIFollowStore, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, {
					isOnboarding,
					isCompleted: !isOnboarding,
					finish: vi.fn(),
				}),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IPushOfferService, pushOffer),
			)
			container.register(MyArtistsRoute)
			const route = container.get(MyArtistsRoute)
			const open = vi.fn()
			route.homeSelector = { open } as never
			return { route, open, ea: container.get(IEventAggregator) }
		}

		// @spec components/infrastructure/fan/web/global/user-home-selector "Signed-in fan without a home opens My Artists"
		it('opens a sheet that closes only on a choice for a signed-in fan, and saves the choice', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.needsHome = true
			const { route, open } = withOnboarding(false)

			await route.loading()
			route.attached()

			expect(route.needsHome).toBe(true)
			expect(open).toHaveBeenCalledOnce()
			expect(route.homeRequired).toBe(true)

			const openIfFirstVisit = vi.fn()
			route.pageHelp = { openIfFirstVisit } as never

			await route.onHomeSelected('JP-13')

			expect(mockUserStore.saveHome).toHaveBeenCalledWith('JP-13')
			expect(route.needsHome).toBe(false)
			// The first-visit help waits until the home sheet has finished
			// closing, so the two sheets are never open together.
			expect(openIfFirstVisit).not.toHaveBeenCalled()
			route.onHomeSheetHidden()
			expect(openIfFirstVisit).toHaveBeenCalledOnce()
		})

		// @spec components/infrastructure/fan/web/global/user-home-selector "Guest after onboarding closes the sheet"
		it('lets a guest after onboarding close the sheet, and asks again on the next visit', async () => {
			mockAuth.isAuthenticated = false
			mockUserStore.needsHome = true
			const first = withOnboarding(false)
			await first.route.loading()
			first.route.attached()
			expect(first.open).toHaveBeenCalledOnce()
			expect(first.route.homeRequired).toBe(false)

			const next = withOnboarding(false)
			await next.route.loading()
			next.route.attached()
			expect(next.open).toHaveBeenCalledOnce()
		})

		it('keeps the sheet closable only on a choice for a guest in onboarding', () => {
			mockAuth.isAuthenticated = false
			expect(withOnboarding(true).route.homeRequired).toBe(true)
		})

		it('does not open the sheet for a person with a home', async () => {
			const { route, open } = withOnboarding(false)
			await route.loading()
			route.attached()
			expect(route.needsHome).toBe(false)
			expect(open).not.toHaveBeenCalled()
		})

		it('keeps the sheet open with an error snack when saving the home fails', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.needsHome = true
			mockUserStore.saveHome.mockRejectedValueOnce(new Error('unavailable'))
			const { route, open, ea } = withOnboarding(false)
			const snacks: Snack[] = []
			ea.subscribe(Snack, (snack: Snack) => {
				snacks.push(snack)
			})
			await route.loading()

			// Rejecting keeps the selector open on the choice.
			await expect(route.onHomeSelected('JP-13')).rejects.toThrow('unavailable')

			expect(route.needsHome).toBe(true)
			expect(open).not.toHaveBeenCalled()
			expect(snacks.map((x) => x.severity)).toEqual(['error'])
		})
	})

	describe('remove button (edit mode)', () => {
		beforeEach(async () => {
			await sut.loadArtists()
		})

		it('should unfollow and publish undo snack', () => {
			sut.unfollowArtist(sut.artists[0])

			expect(sut.artists).toHaveLength(2)
			expect(publishedSnacks).toHaveLength(1)
			expect(publishedSnacks[0].action).toBeDefined()
			expect(publishedSnacks[0].action?.label).toBe('myArtists.undo')
		})

		it('should not unfollow during onboarding (onboarding block)', async () => {
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
			await onboardingSut.loadArtists()

			onboardingSut.unfollowArtist(onboardingSut.artists[0])

			expect(onboardingSut.artists).toHaveLength(3)
		})
	})

	describe('editing mode', () => {
		beforeEach(async () => {
			await sut.loadArtists()
		})

		it('toggleEditing enters and leaves edit mode', () => {
			expect(sut.editing).toBe(false)

			sut.toggleEditing()
			expect(sut.editing).toBe(true)

			sut.toggleEditing()
			expect(sut.editing).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit mode is not persisted across navigation"
		it('edit mode is not persisted across navigation: loading() resets to false', async () => {
			sut.editing = true
			await sut.loading()
			expect(sut.editing).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit mode exits when the last artist is removed"
		it('auto-exits edit mode when the last artist is removed', () => {
			sut.editing = true
			// Remove all artists one by one
			for (let i = sut.artists.length - 1; i >= 0; i--) {
				sut.unfollowArtist(sut.artists[i])
			}
			expect(sut.artists).toHaveLength(0)
			expect(sut.editing).toBe(false)
		})

		it('removes artist and triggers undo snack in edit mode (remove-unfollow path)', () => {
			sut.editing = true
			const artist = sut.artists[0]

			sut.unfollowArtist(artist)

			expect(sut.artists).toHaveLength(2)
			expect(publishedSnacks).toHaveLength(1)
		})

		it('undo restores artist removed via edit mode', () => {
			sut.editing = true
			const artist = sut.artists[1]
			sut.unfollowArtist(artist)

			expect(sut.artists).toHaveLength(2)

			publishedSnacks[0].action?.callback()

			expect(sut.artists).toHaveLength(3)
			expect(sut.artists[1].artist.name).toBe('ONE OK ROCK')
		})

		it('undo after auto-exit restores editing=true so remove buttons reappear', () => {
			// Reproduce the bug: last artist removed → editing auto-exits → undo
			sut.editing = true
			// Remove down to 1 artist first
			sut.unfollowArtist(sut.artists[2])
			sut.unfollowArtist(sut.artists[1])
			expect(sut.artists).toHaveLength(1)
			expect(sut.editing).toBe(true)

			// Remove the last artist — editing must auto-exit
			sut.unfollowArtist(sut.artists[0])
			expect(sut.artists).toHaveLength(0)
			expect(sut.editing).toBe(false)

			// Undo — editing must be restored
			publishedSnacks[publishedSnacks.length - 1].action?.callback()

			expect(sut.artists).toHaveLength(1)
			expect(sut.editing).toBe(true)
		})

		it('detaching resets editing to false', async () => {
			sut.editing = true
			sut.detaching()
			expect(sut.editing).toBe(false)
		})
	})

	describe('undo', () => {
		beforeEach(async () => {
			vi.useFakeTimers()
			await sut.loadArtists()
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

		it('should commit unfollow RPC when snack is dismissed', async () => {
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
			await sut.loadArtists()
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
					Registration.instance(IPushOfferService, pushOffer),
				)
				container.register(MyArtistsRoute)
				onboardingSut = container.get(MyArtistsRoute)
				await onboardingSut.loadArtists()
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
				await sut.loadArtists()
			})

			// @spec components/infrastructure/fan/web/route/my-artists "Guest changes hype"
			it('should accept hype change and persist via the follow service (guest routing is internal)', async () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')
				await Promise.resolve()

				expect(pushOffer.accept).not.toHaveBeenCalled()

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
				await sut.loadArtists()
			})

			it('should accept hype change and call setHype RPC', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')

				expect(artist.hype).toBe('away')
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-1', 'away')
			})

			// @spec components/infrastructure/fan/web/route/my-artists "Save fails"
			it('should revert hype on RPC failure after retry, with no hype snack', async () => {
				mockFollowService.setHype.mockRejectedValue(new Error('fail'))
				const artist = sut.artists[0]
				const originalHype = artist.hype

				sut.onHypeInput(artist, 'away')

				await vi.waitFor(() => {
					expect(mockFollowService.setHype).toHaveBeenCalledTimes(2)
					expect(publishedSnacks.map((s) => s.message)).toContain(
						'myArtists.failedHype',
					)
				})
				expect(artist.hype).toBe(originalHype)
				expect(publishedSnacks.map((s) => s.message)).toEqual([
					'myArtists.failedHype',
				])
			})

			it('should no-op when hype has not changed', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, artist.hype as 'nearby')

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})
	})

	describe('hype snack', () => {
		let route: InstanceType<typeof MyArtistsRoute>
		let snacks: Snack[]

		/** The visible snack texts: a snack with a replaceKey replaces its own. */
		const texts = () => snacks.map((snack) => snack.message)

		/** Let the route read the push state and publish its snack. */
		const settle = () =>
			vi.waitFor(() => expect(pushOffer.pushState).toHaveBeenCalled())

		beforeEach(async () => {
			const { I18N } = await import('@aurelia/i18n')
			const { createCatalogI18n } = await import('../helpers/catalog-i18n')
			const container = createTestContainer(
				Registration.instance(mockIFollowStore, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, {
					isOnboarding: false,
					isCompleted: true,
					finish: vi.fn(),
				}),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IPushOfferService, pushOffer),
			)
			// The words the fan reads, from the real catalog.
			container.deregister(I18N)
			container.register(Registration.instance(I18N, createCatalogI18n()))
			container.register(MyArtistsRoute)
			route = container.get(MyArtistsRoute)
			snacks = []
			container
				.get(IEventAggregator)
				.subscribe(Snack, (snack: Snack) => snacks.push(snack))
			mockFollowService.listFollowed.mockResolvedValue([
				makeFollowedArtist('id-1', 'ヨルシカ', 'watch'),
				makeFollowedArtist('id-2', 'YOASOBI', 'watch'),
				makeFollowedArtist('id-3', 'Vaundy', 'watch'),
				makeFollowedArtist('id-4', 'King Gnu', 'nearby'),
			])
			mockAuth.isAuthenticated = true
			await route.loadArtists()
		})

		const artist = (name: string) => {
			const found = route.artists.find((a) => a.artist.name === name)
			if (!found) throw new Error(name)
			return found
		}

		// @spec components/infrastructure/fan/web/route/my-artists "First pick of Away with push on"
		it('says where new concerts are pushed the first time a level is picked with push on', async () => {
			pushOffer.pushState.mockResolvedValue('on')

			route.onHypeInput(artist('ヨルシカ'), 'away')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			expect(texts()).toEqual([
				'ヨルシカの全ての新着ライブをプッシュ通知します🔔',
			])
			expect(snacks[0].action).toBeUndefined()
			expect(snacks[0].options?.replaceKey).toBe('hype:id-1')
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Second pick of the same level"
		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission already granted"
		it('shows no snack for a later pick of the same level with push on', async () => {
			pushOffer.pushState.mockResolvedValue('on')
			route.onHypeInput(artist('ヨルシカ'), 'away')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			route.onHypeInput(artist('YOASOBI'), 'away')
			await vi.waitFor(() =>
				expect(mockFollowService.setHype).toHaveBeenCalledWith('id-2', 'away'),
			)
			await vi.waitFor(() =>
				expect(pushOffer.pushState).toHaveBeenCalledTimes(2),
			)
			await Promise.resolve()

			expect(artist('YOASOBI').hype).toBe('away')
			expect(snacks).toHaveLength(1)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Nearby with push off"
		// @spec components/infrastructure/fan/web/global/notification-prompt "Offer after a hype change"
		// @spec components/infrastructure/fan/web/global/notification-prompt "Every hype change with push off"
		it('offers push on every change while push is off', async () => {
			route.onHypeInput(artist('Vaundy'), 'nearby')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))
			route.onHypeInput(artist('Vaundy'), 'home')
			route.onHypeInput(artist('Vaundy'), 'nearby')
			await vi.waitFor(() => expect(snacks).toHaveLength(3))

			expect(snacks[2].message).toBe(
				'Vaundyの東京周辺の新着ライブをプッシュ通知で受け取ろう🔔',
			)
			expect(snacks[2].action?.label).toBe('オンにする')
		})

		it('asks the browser at once when the fan presses the offer', async () => {
			route.onHypeInput(artist('Vaundy'), 'nearby')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			snacks[0].action?.callback()

			// Synchronously inside the press, so the browser prompt follows it.
			expect(pushOffer.accept).toHaveBeenCalledWith({
				source: 'notification_prompt',
			})
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission blocked"
		// @spec components/infrastructure/fan/web/global/notification-prompt "iOS Safari without the app on the home screen"
		it('links to Settings instead of an offer where push cannot be turned on here', async () => {
			pushOffer.pushState.mockResolvedValue('settings')

			route.onHypeInput(artist('Vaundy'), 'away')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			expect(snacks[0].action?.label).toBe('設定')
			snacks[0].action?.callback()
			expect(mockRouter.load).toHaveBeenCalledWith('settings')
			expect(pushOffer.accept).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Watch for the first time"
		it('says Watch pushes nothing the first time Watch is picked with push on', async () => {
			pushOffer.pushState.mockResolvedValue('on')

			route.onHypeInput(artist('King Gnu'), 'watch')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			expect(texts()).toEqual(['King Gnuの新着ライブはプッシュ通知しません'])
		})

		it('shows no snack for Watch while push is off', async () => {
			route.onHypeInput(artist('King Gnu'), 'watch')
			await settle()
			await Promise.resolve()

			expect(snacks).toHaveLength(0)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Guest picks Home"
		// @spec components/infrastructure/fan/web/global/notification-prompt "Guest"
		it('invites a guest to sign up the first time a level is picked', async () => {
			mockAuth.isAuthenticated = false
			mockUserStore.currentHome = 'JP-27'

			route.onHypeInput(artist('ヨルシカ'), 'home')
			route.onHypeInput(artist('YOASOBI'), 'home')

			expect(texts()).toEqual([
				'ヨルシカの大阪の新着ライブをプッシュ通知で受け取ろう🔔',
			])
			expect(snacks[0].action?.label).toBe('登録する')
			expect(pushOffer.pushState).not.toHaveBeenCalled()
			snacks[0].action?.callback()
			expect(mockAuth.signUp).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/fan/web/global/page-help "Hype snack flags cleared at sign-up"
		it('shows the snack for a level again once sign-up cleared the onboarding flags', async () => {
			const { saveHypeSnackSeen, clearOnboardingSeenFlags } = await import(
				'../../src/adapter/storage/onboarding-storage'
			)
			mockAuth.isAuthenticated = false
			saveHypeSnackSeen('away')
			route.onHypeInput(artist('ヨルシカ'), 'away')
			expect(snacks).toHaveLength(0)

			// Sign-up completes: the callback's UserStore.clearGuest() clears them.
			clearOnboardingSeenFlags()
			mockAuth.isAuthenticated = true
			pushOffer.pushState.mockResolvedValue('on')
			route.onHypeInput(artist('YOASOBI'), 'away')

			await vi.waitFor(() =>
				expect(texts()).toEqual([
					'YOASOBIの全ての新着ライブをプッシュ通知します🔔',
				]),
			)
		})

		it('shows a guest no snack for Watch', () => {
			mockAuth.isAuthenticated = false

			route.onHypeInput(artist('King Gnu'), 'watch')

			expect(snacks).toHaveLength(0)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Quick changes to one artist"
		it('keys every hype snack by artist so a newer one replaces the earlier', async () => {
			pushOffer.pushState.mockResolvedValue('on')

			route.onHypeInput(artist('ヨルシカ'), 'home')
			route.onHypeInput(artist('ヨルシカ'), 'away')
			await vi.waitFor(() => expect(snacks).toHaveLength(2))

			// The snack bar shows only the latest snack of a replaceKey
			// (snack-bar "Replacing an earlier snack").
			expect(snacks.map((snack) => snack.options?.replaceKey)).toEqual([
				'hype:id-1',
				'hype:id-1',
			])
			expect(snacks[1].message).toBe(
				'ヨルシカの全ての新着ライブをプッシュ通知します🔔',
			)
		})

		it('names 居住エリア without a home', async () => {
			pushOffer.pushState.mockResolvedValue('on')
			mockUserStore.currentHome = null

			route.onHypeInput(artist('ヨルシカ'), 'nearby')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))

			expect(texts()).toEqual([
				'ヨルシカの居住エリア周辺の新着ライブをプッシュ通知します🔔',
			])
		})
	})

	describe('Edit in the action launcher', () => {
		let fab: {
			register: ReturnType<typeof vi.fn>
			hide: ReturnType<typeof vi.fn>
		}
		let showLauncher: ReturnType<typeof vi.fn>
		let route: InstanceType<typeof MyArtistsRoute>

		/** The ids of the actions the route last contributed to the launcher. */
		const actions = () =>
			((fab.register.mock.lastCall?.[1] ?? []) as { id: string }[]).map(
				(a) => a.id,
			)

		beforeEach(async () => {
			const { IFabMenuService } = await import(
				'../../src/services/fab-menu-service'
			)
			showLauncher = vi.fn()
			fab = { register: vi.fn(() => vi.fn()), hide: vi.fn(() => showLauncher) }
			const container = createTestContainer(
				Registration.instance(mockIFollowStore, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, {
					isOnboarding: false,
					isCompleted: true,
					finish: vi.fn(),
				}),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(IPushOfferService, pushOffer),
				Registration.instance(IFabMenuService, fab),
			)
			container.register(MyArtistsRoute)
			route = container.get(MyArtistsRoute)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit hidden when there is nothing to edit"
		it('offers only Help while loading or with no followed artist', async () => {
			route.attached()
			expect(actions()).toEqual(['help'])

			mockFollowService.listFollowed.mockResolvedValue([])
			await route.loadArtists()
			route.attached()
			expect(actions()).toEqual(['help'])
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit offered in the action launcher"
		// @spec components/infrastructure/fan/web/route/my-artists "Entering edit mode reveals remove controls"
		it('offers Edit next to Help; Edit enters edit mode and hides the launcher', async () => {
			await route.loadArtists()
			route.attached()
			// The shell appends Settings after these (test/app-shell.spec.ts).
			expect(actions()).toEqual(['edit', 'help'])

			const edit = (
				(fab.register.mock.lastCall?.[1] ?? []) as {
					id: string
					invoke(): void
				}[]
			).find((a) => a.id === 'edit')
			edit?.invoke()

			expect(route.editing).toBe(true)
			// The whole launcher is hidden, the Settings item included.
			expect(fab.hide).toHaveBeenCalledWith(route)
			expect(showLauncher).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Leaving edit mode hides remove controls"
		it('Done leaves edit mode and brings the launcher back', async () => {
			await route.loadArtists()
			route.editing = true

			route.toggleEditing()

			expect(route.editing).toBe(false)
			expect(showLauncher).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit mode exits when the last artist is removed"
		it('brings the launcher back when the last artist is removed', async () => {
			await route.loadArtists()
			route.editing = true
			for (let i = route.artists.length - 1; i >= 0; i--) {
				route.unfollowArtist(route.artists[i])
			}
			expect(route.editing).toBe(false)
			expect(showLauncher).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Edit mode is not persisted across navigation"
		it('brings the launcher back when the fan leaves the page in edit mode', async () => {
			await route.loadArtists()
			route.editing = true
			route.detaching()
			expect(showLauncher).toHaveBeenCalledTimes(1)
			expect(fab.hide).toHaveBeenCalledTimes(1)
		})
	})

	describe('edit mode markup', () => {
		// @spec components/infrastructure/fan/web/route/my-artists "Remove control is available on all pointer types"
		// @spec components/infrastructure/fan/web/route/my-artists "Default (non-editing) list shows no persistent per-row unfollow control"
		it('shows a one-tap remove button only while editing, in place of the hype dots', async () => {
			const { default: rowHtml } = await import(
				'../../src/routes/my-artists/artist-hype-row.html?raw'
			)
			const { default: routeHtml } = await import(
				'../../src/routes/my-artists/my-artists-route.html?raw'
			)
			const remove = rowHtml.match(
				/<td if\.bind="editing" class="artist-remove-col">[\s\S]*?<\/td>/,
			)?.[0]
			// The remove cell exists only in edit mode; the dots only outside it.
			expect(remove).toBeDefined()
			expect(rowHtml).toMatch(
				/<template if\.bind="!editing">\s*<td repeat\.for="level of hypeLevels"/,
			)
			// A plain button activated by click (tap or mouse), with no timed or
			// path-based gesture anywhere on the list; the route unfollows on the
			// row's request and nowhere else.
			expect(remove).toMatch(
				/<button[\s\S]*type="button"[\s\S]*click\.trigger="unfollow\(\)"/,
			)
			for (const html of [rowHtml, routeHtml]) {
				expect(html).not.toMatch(/long-?press|swipe|pointerdown|touchstart/i)
			}
			expect(rowHtml.match(/unfollow\(\)/g)).toHaveLength(1)
			expect(routeHtml.match(/unfollowArtist\(/g)).toHaveLength(1)
			expect(routeHtml).toMatch(
				/unfollow-requested\.trigger="unfollowArtist\(\$event\.detail\.artist\)"/,
			)
		})
	})
})
