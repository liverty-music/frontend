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
		shouldOffer: ReturnType<typeof vi.fn>
		offer: ReturnType<typeof vi.fn>
	}

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

		pushOffer = { shouldOffer: vi.fn(() => true), offer: vi.fn() }

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

				expect(pushOffer.offer).not.toHaveBeenCalled()

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
			it('should revert hype on RPC failure after retry, with no push offer', async () => {
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
				expect(pushOffer.offer).not.toHaveBeenCalled()
			})

			// @spec components/infrastructure/fan/web/route/my-artists "Signed-in fan changes hype and is offered push"
			// @spec components/infrastructure/fan/web/global/notification-prompt "Offer after a hype change"
			it('offers push once the hype change is saved', async () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, 'away')

				await vi.waitFor(() => expect(pushOffer.offer).toHaveBeenCalledTimes(1))
				expect(pushOffer.offer).toHaveBeenCalledWith(
					'pushOffer.hypeChanged name=RADWIMPS hype=Away',
				)
			})

			it('offers push when the save succeeds on the retry', async () => {
				mockFollowService.setHype.mockRejectedValueOnce(new Error('fail'))

				sut.onHypeInput(sut.artists[0], 'home')

				await vi.waitFor(() => expect(pushOffer.offer).toHaveBeenCalledTimes(1))
			})

			// @spec components/infrastructure/fan/web/route/my-artists "Second hype change in the same session"
			it('applies a hype change without an offer when the offer may not be shown', async () => {
				pushOffer.shouldOffer.mockReturnValue(false)
				const artist = sut.artists[1]

				sut.onHypeInput(artist, 'home')

				await vi.waitFor(() =>
					expect(mockFollowService.setHype).toHaveBeenCalledWith(
						'id-2',
						'home',
					),
				)
				await Promise.resolve()
				expect(artist.hype).toBe('home')
				expect(pushOffer.offer).not.toHaveBeenCalled()
			})

			it('should no-op when hype has not changed', () => {
				const artist = sut.artists[0]

				sut.onHypeInput(artist, artist.hype as 'nearby')

				expect(mockFollowService.setHype).not.toHaveBeenCalled()
			})
		})
	})

	describe('push offer after a hype change (with the offer service)', () => {
		// @spec components/infrastructure/fan/web/route/my-artists "Pressing the action asks the browser"
		it('asks the browser for permission at once when the fan presses 「オンにする」', async () => {
			;(globalThis as Record<string, unknown>).Notification = class {}
			;(globalThis as Record<string, unknown>).PushManager = class {}
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				value: {},
			})
			const { INotificationManager } = await import(
				'../../src/services/notification-manager'
			)
			const { IPushService } = await import('../../src/services/push-service')
			const { ILocalStorage } = await import(
				'../../src/adapter/storage/local-storage'
			)
			const { IAnalyticsService } = await import(
				'../../src/lib/analytics/analytics-service'
			)
			const { createMockLocalStorage } = await import(
				'../helpers/mock-local-storage'
			)
			const push = { create: vi.fn(async () => null) }
			const container = createTestContainer(
				Registration.instance(mockIFollowStore, mockFollowService),
				Registration.instance(mockIRouter, mockRouter),
				Registration.instance(mockIOnboardingService, {
					isOnboarding: false,
					isCompleted: true,
					finish: vi.fn(),
				}),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(INotificationManager, { permission: 'default' }),
				Registration.instance(IPushService, push),
				Registration.instance(ILocalStorage, createMockLocalStorage()),
				Registration.instance(IAnalyticsService, { capture: vi.fn() }),
			)
			container.register(MyArtistsRoute)
			const route = container.get(MyArtistsRoute)
			const snacks: Snack[] = []
			container
				.get(IEventAggregator)
				.subscribe(Snack, (snack: Snack) => snacks.push(snack))
			mockAuth.isAuthenticated = true
			await route.loadArtists()

			route.onHypeInput(route.artists[0], 'away')
			await vi.waitFor(() => expect(snacks).toHaveLength(1))
			snacks[0].action?.callback()

			expect(push.create).toHaveBeenCalledTimes(1)
			delete (globalThis as Record<string, unknown>).Notification
			delete (globalThis as Record<string, unknown>).PushManager
			delete (navigator as unknown as Record<string, unknown>).serviceWorker
		})
	})

	describe('Edit in the action launcher', () => {
		let fab: { register: ReturnType<typeof vi.fn> }
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
			fab = { register: vi.fn(() => vi.fn()) }
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
		it('offers Edit next to Help; Edit enters edit mode and the launcher steps aside', async () => {
			await route.loadArtists()
			route.attached()
			expect(actions()).toEqual(['edit', 'help'])

			const edit = (
				(fab.register.mock.lastCall?.[1] ?? []) as {
					id: string
					invoke(): void
				}[]
			).find((a) => a.id === 'edit')
			edit?.invoke()
			;(
				route as unknown as { onFabContextChanged(): void }
			).onFabContextChanged()

			expect(route.editing).toBe(true)
			expect(actions()).toEqual([])
		})

		// @spec components/infrastructure/fan/web/route/my-artists "Leaving edit mode hides remove controls"
		it('Done leaves edit mode and brings the launcher back', async () => {
			await route.loadArtists()
			route.editing = true

			route.toggleEditing()
			;(
				route as unknown as { onFabContextChanged(): void }
			).onFabContextChanged()

			expect(route.editing).toBe(false)
			expect(actions()).toEqual(['edit', 'help'])
		})
	})

	describe('edit mode markup', () => {
		// @spec components/infrastructure/fan/web/route/my-artists "Remove control is available on all pointer types"
		// @spec components/infrastructure/fan/web/route/my-artists "Default (non-editing) list shows no persistent per-row unfollow control"
		it('shows a one-tap remove button only while editing, in place of the hype dots', async () => {
			const { default: html } = await import(
				'../../src/routes/my-artists/my-artists-route.html?raw'
			)
			const remove = html.match(
				/<td if\.bind="editing" class="artist-remove-col">[\s\S]*?<\/td>/,
			)?.[0]
			// The remove cell exists only in edit mode; the dots only outside it.
			expect(remove).toBeDefined()
			expect(html).toMatch(
				/<template if\.bind="!editing">\s*<td repeat\.for="level of hypeLevels"/,
			)
			// A plain button activated by click (tap or mouse), with no timed or
			// path-based gesture anywhere on the list.
			expect(remove).toMatch(
				/<button[\s\S]*type="button"[\s\S]*click\.trigger="unfollowArtist\(artist\)"/,
			)
			expect(html).not.toMatch(/long-?press|swipe|pointerdown|touchstart/i)
			expect(html.match(/unfollowArtist\(/g)).toHaveLength(1)
		})
	})
})
