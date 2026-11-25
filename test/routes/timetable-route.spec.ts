import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import {
	type IActionMenuService,
	settingsAction,
} from '../../src/services/action-menu-service'
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

const { TimetableRoute } = await import(
	'../../src/routes/timetable/timetable-route'
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

// UserStore owns the home decision (`needsHome`, for guests and signed-in
// fans alike) and its save (`saveHome`: SetHome or guest storage).
function makeUserStore() {
	return {
		current: undefined as { home: unknown } | undefined,
		guestHome: null as string | null,
		currentHome: null as string | null,
		needsHome: true,
		saveHome: vi.fn().mockResolvedValue(undefined),
	}
}

// ---- Suite ----

describe('TimetableRoute', () => {
	let sut: InstanceType<typeof TimetableRoute>
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
		container.register(TimetableRoute)
		return container.get(TimetableRoute)
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

		sut = buildSut()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	// ---- loading() ----

	describe('loading', () => {
		it('asks a person without a home, guest or signed in', async () => {
			for (const isAuthenticated of [false, true]) {
				mockAuth.isAuthenticated = isAuthenticated
				mockUserStore.needsHome = true
				sut = buildSut()

				await sut.loading()

				expect(sut.needsRegion).toBe(true)
			}
		})

		it('does not ask a person with a home', async () => {
			mockUserStore.needsHome = false

			await sut.loading()

			expect(sut.needsRegion).toBe(false)
		})

		it('keeps the sheet open until a choice for a signed-in fan and a guest in onboarding only', () => {
			mockAuth.isAuthenticated = true
			expect(buildSut().homeRequired).toBe(true)

			mockAuth.isAuthenticated = false
			mockOnboarding = makeOnboarding(true)
			expect(buildSut().homeRequired).toBe(true)

			mockOnboarding = makeOnboarding(false)
			expect(buildSut().homeRequired).toBe(false)
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
			mockUserStore.needsHome = false
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
			expect(mockStorage.removeItem).not.toHaveBeenCalled()
			expect(sut.showPostSignupDialog).toBe(false)

			sut.onCelebrationDismissed()

			expect(sut.showPostSignupDialog).toBe(true)
			expect(mockStorage.removeItem).toHaveBeenCalledWith(
				StorageKeys.postSignupShown,
			)
		})

		it('does not show postSignupDialog when flag is absent', async () => {
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showPostSignupDialog).toBe(false)
		})

		it('latches finish() on a meaningful first timetable arrival (onboarding + follows + region set)', async () => {
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
		it('sets needsRegion=false and triggers loadData once the home is saved', async () => {
			sut.needsRegion = true
			const loadSpy = vi.spyOn(sut, 'loadData').mockResolvedValue()

			await sut.onHomeSelected('JP-13')

			expect(sut.needsRegion).toBe(false)
			expect(loadSpy).toHaveBeenCalledOnce()
		})

		it('resolves once the home is saved, before the timetable has loaded', async () => {
			// The selector closes when this resolves, so the sheet never stays
			// open over the timetable load or the celebration that follows it.
			vi.spyOn(sut, 'loadData').mockReturnValue(new Promise<void>(() => {}))

			await sut.onHomeSelected('JP-13')

			expect(sut.needsRegion).toBe(false)
		})

		it('saves the choice through the user store', async () => {
			vi.spyOn(sut, 'loadData').mockResolvedValue()

			await sut.onHomeSelected('JP-13')

			expect(mockUserStore.saveHome).toHaveBeenCalledWith('JP-13')
		})
	})

	// ---- FAB actions ----

	describe('FAB actions', () => {
		type Action = { id: string; labelKey: string }
		function registered(): string[][] {
			const register = (
				sut as unknown as { actionMenu: { register: ReturnType<typeof vi.fn> } }
			).actionMenu.register
			return register.mock.calls.map(([, actions]) =>
				(actions as Action[]).map((a) => a.id),
			)
		}

		beforeEach(() => {
			const actionMenu = (sut as unknown as { actionMenu: object }).actionMenu
			vi.spyOn(
				actionMenu as { register: (o: object, a: Action[]) => () => void },
				'register',
			)
		})

		// @spec components/infrastructure/fan/web/global/action-menu "Timetable contributes its actions"
		// @spec components/infrastructure/fan/web/global/action-menu "Toggle button placement and icon"
		it('contributes the beam toggle, the filter and help to a fan who is not onboarding', () => {
			sut.attached()
			expect(registered().at(-1)).toEqual(['beam', 'filter', 'help'])
			const beam = (
				sut as unknown as {
					buildMenuActions(): (Action & { icon: string; kind: string })[]
				}
			).buildMenuActions()[0]
			expect(beam).toEqual(
				expect.objectContaining({
					icon: 'spotlight',
					kind: 'toggle',
					labelKey: 'actionMenu.beam',
				}),
			)
			sut.detaching()
		})

		// The shell sets the Settings item as the launcher's trailing item on
		// every tab page (test/app-shell.spec.ts); the arc lays the items out
		// from the FAB outward in this order (action-menu.stories.ts OpenArc).
		// @spec components/infrastructure/fan/web/global/action-menu "Settings is the last item on the timetable"
		it('ends the launcher with Settings after the timetable actions', () => {
			const actionMenu = (sut as unknown as { actionMenu: IActionMenuService })
				.actionMenu
			actionMenu.setTrailing(settingsAction(() => {}))
			sut.attached()
			expect(actionMenu.actions.map((a) => a.id)).toEqual([
				'beam',
				'filter',
				'help',
				'settings',
			])
			sut.detaching()
			actionMenu.setTrailing(null)
		})

		// @spec components/infrastructure/fan/web/global/action-menu "No active filter — header unchanged"
		// @spec components/infrastructure/fan/web/global/action-menu "Active filter — icon state only"
		// @spec components/infrastructure/fan/web/global/action-menu "Dismissing an active filter"
		it('lights the filter item while a filter is active and opens the sheet from it, never a header chip', async () => {
			const filterBar = { isFilterActive: false, openSheet: vi.fn() }
			sut.filterBar = filterBar as unknown as typeof sut.filterBar
			const filter = (
				sut as unknown as {
					buildMenuActions(): (Action & {
						isOn(): boolean
						invoke(): void
					})[]
				}
			)
				.buildMenuActions()
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
				'../../src/routes/timetable/timetable-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			expect(
				doc.querySelector('.filter-chip, [data-testid*="filter"]'),
			).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/action-menu "No filter trigger in the header"
		it('puts no filter trigger in the page header', async () => {
			const { default: header } = await import(
				'../../src/components/page-header/page-header.html?raw'
			)
			expect(header).not.toMatch(/filter/i)
		})

		// @spec components/infrastructure/fan/web/global/action-menu "Actions removed on navigation away"
		it('removes its actions when the fan leaves the timetable', () => {
			const actionMenu = (
				sut as unknown as { actionMenu: { actions: Action[] } }
			).actionMenu
			sut.attached()
			expect(actionMenu.actions.map((a) => a.id)).toEqual([
				'beam',
				'filter',
				'help',
			])
			sut.detaching()
			expect(actionMenu.actions).toEqual([])
		})

		// @spec components/infrastructure/fan/web/global/action-menu "Within-route mode change replaces, not accumulates"
		it('replaces its set when onboarding ends, adding the filter without duplicates', () => {
			mockOnboarding = makeOnboarding(true)
			sut = buildSut()
			const actionMenu = (
				sut as unknown as {
					actionMenu: {
						register: (o: object, a: Action[]) => () => void
						actions: Action[]
					}
				}
			).actionMenu
			const register = vi.spyOn(actionMenu, 'register')
			sut.attached()
			expect(actionMenu.actions.map((a) => a.id)).toEqual(['beam', 'help'])

			mockOnboarding.isOnboarding = false
			;(sut as unknown as { onFabContextChanged(): void }).onFabContextChanged()

			expect(register).toHaveBeenCalledTimes(2)
			expect(actionMenu.actions.map((a) => a.id)).toEqual([
				'beam',
				'filter',
				'help',
			])
			sut.detaching()
			expect(actionMenu.actions).toEqual([])
		})
	})

	describe('empty timetable offers the Concerts view', () => {
		async function emptyStates() {
			const { default: html } = await import(
				'../../src/routes/timetable/timetable-route.html?raw'
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
					a.getAttribute('if.bind'),
				]),
			}))
		}

		// @spec components/infrastructure/fan/web/route/timetable "Guest with no follows"
		it('offers a guest who follows no artist only the link to Discovery', async () => {
			mockAuth.isAuthenticated = false
			mockFollow.followedCount = 0
			expect(sut.showGuestEmptyState).toBe(true)

			const guest = (await emptyStates()).find((p) =>
				p.gate.includes('&& showGuestEmptyState'),
			)
			expect(guest?.links).toEqual([
				['/discovery', 'timetable.guestEmpty.cta', null],
			])
		})

		// @spec components/infrastructure/fan/web/route/timetable "Signed-in fan with no follows"
		it('offers a signed-in fan who follows no artist both links', async () => {
			mockAuth.isAuthenticated = true
			mockFollow.followedCount = 0
			await sut.loadData()
			expect(sut.showGuestEmptyState).toBe(false)
			expect(sut.isAuthenticated).toBe(true)

			const empty = (await emptyStates()).find((p) =>
				p.gate.includes(
					'!showGuestEmptyState && filteredDateGroups.length === 0',
				),
			)
			expect(empty?.links).toEqual([
				['/discovery', 'timetable.empty.discoverLink', null],
				[
					'/discovery?view=concerts',
					'timetable.concertsCta',
					'isAuthenticated',
				],
			])
		})

		// @spec components/infrastructure/fan/web/route/timetable "Followed artists with nothing to show"
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
				['/discovery', 'timetable.empty.discoverLink', null],
				[
					'/discovery?view=concerts',
					'timetable.concertsCta',
					'isAuthenticated',
				],
			])
			// A guest in the same state gets the link to Discovery only.
			mockAuth.isAuthenticated = false
			expect(sut.isAuthenticated).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/timetable "Timetable with concerts"
		it('shows no link to the Concerts view while the timetable has a concert', async () => {
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
				'../../src/routes/timetable/timetable-route.html?raw'
			)
			const doc = new DOMParser().parseFromString(
				`<body>${html}</body>`,
				'text/html',
			)
			const nearby = [
				...doc.querySelectorAll('a[href="/discovery?view=concerts"]'),
			]
			expect(nearby).toHaveLength(1)
			for (const link of nearby) {
				expect(link.closest('state-placeholder')).not.toBeNull()
			}
			expect(sut.showGuestEmptyState).toBe(false)
		})
	})

	describe('badge data', () => {
		it('still shows the concerts without badges when statuses and tickets fail to load', async () => {
			// @spec components/infrastructure/fan/web/route/timetable "Statuses cannot be loaded"
			const groups = [{ date: {}, home: [], nearby: [], away: [] }]
			const rendered = [{ dateKey: '2026-11-20' }]
			mockConcert.listFollowed.mockResolvedValue(groups)
			mockConcert.toDateGroups.mockReturnValue(rendered)
			mockJourney.load.mockRejectedValue(new Error('journey down'))
			mockPurchased.load.mockRejectedValue(new Error('tickets down'))

			const result = await (
				sut as unknown as { loadTimetableEvents(): Promise<unknown> }
			).loadTimetableEvents()

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
			// @spec components/infrastructure/fan/web/route/timetable "Open detail from timetable"
			// @spec components/infrastructure/fan/web/route/timetable "Event selection handled by timetable"
			// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow button hidden in My Timetable context"
			const open = vi.fn()
			sut.detailSheet = { open } as unknown as typeof sut.detailSheet

			sut.onEventSelected(selected(false))

			expect(open).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'ev-1' }),
				'timetable',
				false,
			)
			expect(mockRouter.load).not.toHaveBeenCalled()
		})

		it('navigates to the concert page for a first-party concert', () => {
			// @spec components/infrastructure/fan/web/route/timetable "First-party concert opens its concert page"
			const open = vi.fn()
			sut.detailSheet = { open } as unknown as typeof sut.detailSheet

			sut.onEventSelected(selected(true))

			expect(mockRouter.load).toHaveBeenCalledWith('/concerts/ev-1', {
				historyStrategy: 'push',
			})
			expect(open).not.toHaveBeenCalled()
		})

		it('restores the timetable at the date the fan left on return', () => {
			// @spec components/infrastructure/fan/web/route/timetable "Back from the concert page"
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
