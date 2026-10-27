import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createTestContainer } from '../helpers/create-container'
import { createMockHistory } from '../helpers/mock-history'
import { createMockLocalStorage } from '../helpers/mock-local-storage'
import { createMockRouter } from '../helpers/mock-router'

// --- DI tokens (must be created before vi.mock calls) ---
const mockIAuthService = DI.createInterface('IAuthService')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIFollowStore = DI.createInterface('IFollowStore')
const mockITicketJourneyStore = DI.createInterface('ITicketJourneyStore')
const mockIPurchasedTicketStore = DI.createInterface('IPurchasedTicketStore')
const mockIResumeRevalidator = DI.createInterface('IResumeRevalidator')
const mockIOnboardingService = DI.createInterface('IOnboardingService')
const mockIUserStore = DI.createInterface('IUserStore')
const mockILocalStorage = DI.createInterface('ILocalStorage')
const mockIHistory = DI.createInterface('IHistory')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/concert-store', () => ({
	IConcertStore: mockIConcertStore,
}))
vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))
vi.mock('../../src/services/ticket-journey-store', () => ({
	ITicketJourneyStore: mockITicketJourneyStore,
}))
vi.mock('../../src/services/purchased-ticket-store', () => ({
	IPurchasedTicketStore: mockIPurchasedTicketStore,
}))
vi.mock('../../src/services/resume-revalidator', () => ({
	IResumeRevalidator: mockIResumeRevalidator,
}))
vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
}))
vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
}))
vi.mock('../../src/adapter/storage/local-storage', () => ({
	ILocalStorage: mockILocalStorage,
}))
vi.mock('../../src/adapter/browser/history', () => ({
	IHistory: mockIHistory,
}))
vi.mock('../../src/components/user-home-selector/user-home-selector', () => ({
	UserHomeSelector: {
		getStoredHome: vi.fn().mockReturnValue(null),
	},
}))

const { DashboardRoute } = await import(
	'../../src/routes/dashboard/dashboard-route'
)
const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

// ---- Factory helpers ----

function makeOnboarding(isOnboarding = false) {
	return {
		isOnboarding,
		isCompleted: !isOnboarding,
		finish: vi.fn(),
	}
}

/** The store's rendered timetable and scroll place, keyed by their inputs. */
function keyedTimetable() {
	const rendered = new Map<
		string,
		{ groups: unknown[]; anchor: { dateKey: string; offset: number } | null }
	>()
	return {
		peekDateGroups: vi.fn((key: string) => rendered.get(key)?.groups ?? null),
		setDateGroups: vi.fn((key: string, groups: unknown[]) => {
			rendered.set(key, { groups, anchor: rendered.get(key)?.anchor ?? null })
		}),
		timetableAnchor: vi.fn((key: string) => rendered.get(key)?.anchor ?? null),
		saveTimetableAnchor: vi.fn(
			(key: string, anchor: { dateKey: string; offset: number } | null) => {
				const entry = rendered.get(key)
				if (entry) entry.anchor = anchor
			},
		),
	}
}

function makeConcertService() {
	return {
		listFollowed: vi.fn().mockResolvedValue([]),
		revalidateFollower: vi.fn().mockResolvedValue([]),
		...keyedTimetable(),
		toDateGroups: vi.fn().mockReturnValue([]),
		listByArtist: vi.fn().mockResolvedValue([]),
	}
}

function makeFollowService() {
	return {
		getFollowedArtistMap: vi.fn().mockResolvedValue(new Map()),
		listFollowed: vi.fn().mockResolvedValue([]),
		followedIds: new Set<string>(),
		followedCount: 0,
	}
}

function makeJourneyStore() {
	return {
		journeyMap: new Map(),
		load: vi.fn().mockResolvedValue(new Map()),
		statusFor: vi.fn().mockReturnValue(undefined),
	}
}

function makePurchasedTicketStore() {
	return {
		countByEvent: new Map<string, number>(),
		load: vi.fn().mockResolvedValue(new Map()),
	}
}

function makeResumeRevalidator() {
	return {
		register: vi.fn(),
		unregister: vi.fn(),
	}
}

// UserStore is the single owner of the User entity (authenticated `current`,
// read for the needsRegion check) AND the guest home write path (setGuestHome)
// the dashboard calls for unauthenticated users.
function makeUserStore() {
	return {
		current: undefined as { home: unknown } | undefined,
		guestHome: null as string | null,
		currentHome: null as string | null,
		setGuestHome: vi.fn(),
	}
}

// ---- Suite ----

describe('DashboardRoute', () => {
	let sut: InstanceType<typeof DashboardRoute>
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
	let mockConcert: ReturnType<typeof makeConcertService>
	let mockFollow: ReturnType<typeof makeFollowService>
	let mockJourney: ReturnType<typeof makeJourneyStore>
	let mockPurchased: ReturnType<typeof makePurchasedTicketStore>
	let mockRouter: ReturnType<typeof createMockRouter>
	let mockResume: ReturnType<typeof makeResumeRevalidator>
	let mockOnboarding: ReturnType<typeof makeOnboarding>
	let mockUserStore: ReturnType<typeof makeUserStore>
	// Alias to the merged store so the existing `mockUser.current` assertions
	// read naturally against the one IUserStore the route now injects.
	let mockUser: typeof mockUserStore
	let mockStorage: ReturnType<typeof createMockLocalStorage>
	let mockHistory: ReturnType<typeof createMockHistory>

	function buildSut() {
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(mockIFollowStore, mockFollow),
			Registration.instance(mockITicketJourneyStore, mockJourney),
			Registration.instance(mockIPurchasedTicketStore, mockPurchased),
			Registration.instance(IRouter, mockRouter),
			Registration.instance(mockIResumeRevalidator, mockResume),
			Registration.instance(mockIOnboardingService, mockOnboarding),
			Registration.instance(mockIUserStore, mockUserStore),
			Registration.instance(mockILocalStorage, mockStorage),
			Registration.instance(mockIHistory, mockHistory),
		)
		container.register(DashboardRoute)
		return container.get(DashboardRoute)
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockAuth = { isAuthenticated: false, signUp: vi.fn() }
		mockConcert = makeConcertService()
		mockFollow = makeFollowService()
		mockJourney = makeJourneyStore()
		mockPurchased = makePurchasedTicketStore()
		mockRouter = createMockRouter()
		mockResume = makeResumeRevalidator()
		mockOnboarding = makeOnboarding()
		mockUserStore = makeUserStore()
		mockUser = mockUserStore
		mockStorage = createMockLocalStorage()
		mockHistory = createMockHistory()
		;(
			UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
		).mockReturnValue(null)

		sut = buildSut()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	// ---- loading() ----

	describe('loading', () => {
		it('sets needsRegion=true for unauthenticated user without stored home', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue(null)

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('sets needsRegion=false for unauthenticated user with stored home', async () => {
			;(
				UserHomeSelector.getStoredHome as ReturnType<typeof vi.fn>
			).mockReturnValue('JP-13')

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('sets needsRegion=true for authenticated user without home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: undefined }

			await sut.loading()

			expect(sut.needsRegion).toBe(true)
		})

		it('sets needsRegion=false for authenticated user with home', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: { countryCode: 'JP', level1: 'JP-13' } }

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('sets showSignupBanner for unauthenticated completed-onboarding user', async () => {
			mockOnboarding = makeOnboarding('completed')
			;(mockOnboarding as { isCompleted: boolean }).isCompleted = true
			sut = buildSut()

			await sut.loading()

			expect(sut.showSignupBanner).toBe(true)
		})

		it('does not set showSignupBanner for authenticated user', async () => {
			mockAuth.isAuthenticated = true
			await sut.loading()
			expect(sut.showSignupBanner).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Data fetch is kicked off non-blocking from loading()"
		it('is non-blocking: resolves before the data fetch settles, isLoading true at attach', async () => {
			mockAuth.isAuthenticated = true
			mockUser.current = { home: { countryCode: 'JP', level1: 'JP-13' } }
			// Fetch never resolves → the timetable would stay a spinner.
			mockConcert.listFollowed.mockReturnValue(new Promise(() => {}))
			sut = buildSut()

			await sut.loading()

			// loading() resolved without awaiting the fetch: region is computed and
			// the spinner is showing.
			expect(sut.needsRegion).toBe(false)
			expect(sut.isLoading).toBe(true)
		})
	})

	// ---- attached() ----

	describe('attached', () => {
		it('opens home selector when needsRegion is true', () => {
			sut.needsRegion = true
			const mockHomeSelector = { open: vi.fn() }
			sut.homeSelector = mockHomeSelector as never

			sut.attached()

			expect(mockHomeSelector.open).toHaveBeenCalledOnce()
		})

		it('does not open home selector when needsRegion is false', () => {
			sut.needsRegion = false
			const mockHomeSelector = { open: vi.fn() }
			sut.homeSelector = mockHomeSelector as never

			sut.attached()

			expect(mockHomeSelector.open).not.toHaveBeenCalled()
		})

		it('does not fire the celebration at attached() while the load is still in flight', () => {
			mockAuth.isAuthenticated = true
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			// Fetch never resolves → timetable stays a spinner.
			mockConcert.listFollowed.mockReturnValue(new Promise(() => {}))
			sut = buildSut()
			sut.needsRegion = false

			void sut.loadData()
			sut.attached()

			// attached() ran over a still-loading timetable: no celebration over a spinner.
			expect(sut.isLoading).toBe(true)
			expect(sut.showCelebration).toBe(false)
		})
	})

	// ---- data-ready side effects (gated on observed data arrival) ----

	describe('data-ready side effects', () => {
		it('shows the post-signup celebration on observed data arrival, then opens the dialog on dismissal', async () => {
			mockAuth.isAuthenticated = true
			mockStorage = createMockLocalStorage({
				[StorageKeys.postSignupShown]: 'pending',
			})
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			// Emotion first: confetti celebration; dialog deferred until dismissal.
			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(true)
			expect(mockStorage.removeItem).toHaveBeenCalledWith(
				StorageKeys.postSignupShown,
			)
			expect(sut.showPostSignupDialog).toBe(false)

			sut.onCelebrationDismissed()

			expect(sut.showPostSignupDialog).toBe(true)
		})

		it('does not show postSignupDialog when flag is absent', async () => {
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showPostSignupDialog).toBe(false)
		})

		it('latches finish() on a meaningful first dashboard arrival (onboarding + follows + region set)', async () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 1
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		it('does not latch when onboarding is already completed', async () => {
			mockOnboarding = makeOnboarding(false)
			mockFollow.followedCount = 5
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does not latch on a zero-follow arrival', async () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 0
			sut = buildSut()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does not latch while the timetable is still loading', () => {
			mockOnboarding = makeOnboarding(true)
			mockFollow.followedCount = 1
			mockConcert.listFollowed.mockReturnValue(new Promise(() => {}))
			sut = buildSut()
			sut.needsRegion = false

			void sut.loadData()

			expect(sut.isLoading).toBe(true)
			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})
	})

	// ---- onHomeSelected() ----

	describe('onHomeSelected', () => {
		it('sets needsRegion=false and triggers loadData', () => {
			sut.needsRegion = true
			const loadSpy = vi.spyOn(sut, 'loadData').mockResolvedValue()

			sut.onHomeSelected('JP-13')

			expect(sut.needsRegion).toBe(false)
			expect(loadSpy).toHaveBeenCalledOnce()
		})

		it('calls userStore.setGuestHome for unauthenticated user', () => {
			mockAuth.isAuthenticated = false
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).toHaveBeenCalledWith('JP-13')
		})

		it('does not call userStore.setGuestHome for authenticated user', () => {
			mockAuth.isAuthenticated = true
			sut = buildSut()

			sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).not.toHaveBeenCalled()
		})
	})

	// ---- FAB actions ----

	describe('FAB actions', () => {
		type Action = { id: string; labelKey: string }
		function registered(): string[][] {
			const register = (
				sut as unknown as { fabMenu: { register: ReturnType<typeof vi.fn> } }
			).fabMenu.register
			return register.mock.calls.map(([, actions]) =>
				(actions as Action[]).map((a) => a.id),
			)
		}

		beforeEach(() => {
			const fabMenu = (sut as unknown as { fabMenu: object }).fabMenu
			vi.spyOn(
				fabMenu as { register: (o: object, a: Action[]) => () => void },
				'register',
			)
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "Dashboard contributes its actions"
		// @spec components/infrastructure/fan/web/global/fab-menu "Toggle button placement and icon"
		it('contributes the beam toggle, the filter and help to a fan who is not onboarding', () => {
			sut.attached()
			expect(registered().at(-1)).toEqual(['beam', 'filter', 'help'])
			const beam = (
				sut as unknown as {
					buildFabActions(): (Action & { icon: string; kind: string })[]
				}
			).buildFabActions()[0]
			expect(beam).toEqual(
				expect.objectContaining({
					icon: 'spotlight',
					kind: 'toggle',
					labelKey: 'fabMenu.beam',
				}),
			)
			sut.detaching()
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "No active filter — header unchanged"
		// @spec components/infrastructure/fan/web/global/fab-menu "Active filter — icon state only"
		// @spec components/infrastructure/fan/web/global/fab-menu "Dismissing an active filter"
		it('lights the filter item while a filter is active and opens the sheet from it, never a header chip', async () => {
			const filterBar = { isFilterActive: false, openSheet: vi.fn() }
			sut.filterBar = filterBar as unknown as typeof sut.filterBar
			const filter = (
				sut as unknown as {
					buildFabActions(): (Action & {
						isOn(): boolean
						invoke(): void
					})[]
				}
			)
				.buildFabActions()
				.find((a) => a.id === 'filter')
			expect(filter?.isOn()).toBe(false)

			filterBar.isFilterActive = true
			expect(filter?.isOn()).toBe(true)

			// The sheet opens with the current selection pre-selected (the filter
			// bar copies it in openSheet), to be reduced or cleared.
			filter?.invoke()
			expect(filterBar.openSheet).toHaveBeenCalledOnce()

			// The route renders no artist chips and no filter trigger of its own;
			// the filter bar renders its sheet only.
			const { default: html } = await import(
				'../../src/routes/dashboard/dashboard-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			expect(
				doc.querySelector('.filter-chip, [data-testid*="filter"]'),
			).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "No filter trigger in the header"
		it('puts no filter trigger in the page header', async () => {
			const { default: header } = await import(
				'../../src/components/page-header/page-header.html?raw'
			)
			expect(header).not.toMatch(/filter/i)
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "Actions removed on navigation away"
		it('removes its actions when the fan leaves the dashboard', () => {
			const fabMenu = (sut as unknown as { fabMenu: { actions: Action[] } })
				.fabMenu
			sut.attached()
			expect(fabMenu.actions.map((a) => a.id)).toEqual([
				'beam',
				'filter',
				'help',
			])
			sut.detaching()
			expect(fabMenu.actions).toEqual([])
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "Within-route mode change replaces, not accumulates"
		it('replaces its set when onboarding ends, adding the filter without duplicates', () => {
			mockOnboarding = makeOnboarding(true)
			sut = buildSut()
			const fabMenu = (
				sut as unknown as {
					fabMenu: {
						register: (o: object, a: Action[]) => () => void
						actions: Action[]
					}
				}
			).fabMenu
			const register = vi.spyOn(fabMenu, 'register')
			sut.attached()
			expect(fabMenu.actions.map((a) => a.id)).toEqual(['beam', 'help'])

			mockOnboarding.isOnboarding = false
			;(sut as unknown as { onFabContextChanged(): void }).onFabContextChanged()

			expect(register).toHaveBeenCalledTimes(2)
			expect(fabMenu.actions.map((a) => a.id)).toEqual([
				'beam',
				'filter',
				'help',
			])
			sut.detaching()
			expect(fabMenu.actions).toEqual([])
		})
	})

	describe('empty timetable offers the All Nearby view', () => {
		async function emptyStates() {
			const { default: html } = await import(
				'../../src/routes/dashboard/dashboard-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			return [...doc.querySelectorAll('state-placeholder')].map((p) => ({
				gate: p.getAttribute('if.bind') ?? '',
				links: [...p.querySelectorAll('a')].map((a) => [
					a.getAttribute('href'),
					a.getAttribute('t'),
				]),
			}))
		}

		// @spec components/infrastructure/fan/web/route/dashboard "Guest with no follows"
		it('offers Discovery and the concerts nearby to a guest who follows no artist', async () => {
			mockAuth.isAuthenticated = false
			mockFollow.followedCount = 0
			expect(sut.showGuestEmptyState).toBe(true)

			const guest = (await emptyStates()).find((p) =>
				p.gate.includes('&& showGuestEmptyState'),
			)
			expect(guest?.links).toEqual([
				['/discovery', 'dashboard.guestEmpty.cta'],
				['/discovery?view=nearby', 'dashboard.nearbyCta'],
			])
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Followed artists with nothing to show"
		it('offers both links when the followed artists have no concert to show', async () => {
			mockAuth.isAuthenticated = true
			mockFollow.followedCount = 3
			await sut.loadData()
			expect(sut.showGuestEmptyState).toBe(false)
			expect(sut.hasSettled).toBe(true)
			expect(sut.filteredDateGroups).toEqual([])

			const empty = (await emptyStates()).find((p) =>
				p.gate.includes(
					'!showGuestEmptyState && filteredDateGroups.length === 0',
				),
			)
			expect(empty?.links).toEqual([
				['/discovery', 'dashboard.empty.discoverLink'],
				['/discovery?view=nearby', 'dashboard.nearbyCta'],
			])
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Timetable with concerts"
		it('shows no link to the All Nearby view while the timetable has a concert', async () => {
			mockAuth.isAuthenticated = true
			mockFollow.followedCount = 1
			sut.dateGroups = [
				{
					dateKey: '2026-11-20',
					home: [{ id: 'c1', artistId: 'a1' }],
					nearby: [],
					away: [],
				},
			] as unknown as typeof sut.dateGroups
			sut.hasSettled = true
			expect(sut.filteredDateGroups).toHaveLength(1)

			// Both links live only inside the empty states, which are gated on an
			// empty timetable (or a guest with no follow).
			const { default: html } = await import(
				'../../src/routes/dashboard/dashboard-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			const nearby = [
				...doc.querySelectorAll('a[href="/discovery?view=nearby"]'),
			]
			expect(nearby).toHaveLength(2)
			for (const link of nearby) {
				expect(link.closest('state-placeholder')).not.toBeNull()
			}
			expect(sut.showGuestEmptyState).toBe(false)
		})
	})

	describe('badge data', () => {
		it('still shows the concerts without badges when statuses and tickets fail to load', async () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Statuses cannot be loaded"
			const groups = [{ date: {}, home: [], nearby: [], away: [] }]
			const rendered = [{ dateKey: '2026-11-20' }]
			mockConcert.listFollowed.mockResolvedValue(groups)
			mockConcert.toDateGroups.mockReturnValue(rendered)
			mockJourney.load.mockRejectedValue(new Error('journey down'))
			mockPurchased.load.mockRejectedValue(new Error('tickets down'))

			const result = await (
				sut as unknown as { loadDashboardEvents(): Promise<unknown> }
			).loadDashboardEvents()

			expect(result).toBe(rendered)
			expect(mockConcert.toDateGroups).toHaveBeenCalledWith(
				groups,
				expect.any(Map),
				new Map(),
				new Map(),
			)
		})
	})

	describe('event selection', () => {
		function selected(isFirstParty: boolean) {
			return new CustomEvent('event-selected', {
				detail: {
					event: { id: 'ev-1', artistId: 'a1', isFirstParty },
				},
			}) as unknown as Parameters<typeof sut.onEventSelected>[0]
		}

		it('opens the detail sheet for a discovered concert', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Open detail from dashboard"
			// @spec components/infrastructure/fan/web/route/dashboard "Event selection handled by dashboard"
			// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button hidden in My Timetable context"
			const open = vi.fn()
			sut.detailSheet = { open } as unknown as typeof sut.detailSheet

			sut.onEventSelected(selected(false))

			expect(open).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'ev-1' }),
				'dashboard',
				false,
			)
			expect(mockRouter.load).not.toHaveBeenCalled()
		})

		it('navigates to the event page for a first-party concert', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "First-party concert opens its event page"
			const open = vi.fn()
			sut.detailSheet = { open } as unknown as typeof sut.detailSheet

			sut.onEventSelected(selected(true))

			expect(mockRouter.load).toHaveBeenCalledWith('/events/ev-1', {
				historyStrategy: 'push',
			})
			expect(open).not.toHaveBeenCalled()
		})

		it('restores the timetable at the date the fan left on return', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Back from the event page"
			const anchor = { dateKey: '2026-11-20', offset: 120 }
			sut.highway = { scrollAnchor: anchor } as unknown as typeof sut.highway
			// The timetable the fan scrolled is the one in the session cache.
			mockConcert.setDateGroups(
				(sut as unknown as { timetableKey(): string }).timetableKey(),
				[],
			)

			sut.onEventSelected(selected(true))
			sut.unloading()

			// The back control re-creates the route, which reads the anchor.
			const returned = buildSut()
			returned.binding()
			expect(returned.timetableAnchor).toEqual(anchor)
		})
	})

	describe('detaching', () => {
		it('aborts active request', () => {
			sut.loadData()
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

			sut.detaching()

			expect(abortSpy).toHaveBeenCalled()
		})
	})
})
