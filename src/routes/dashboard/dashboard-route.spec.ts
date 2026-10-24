import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../entities/artist'
import type { DateGroup, JourneyStatus } from '../../entities/concert'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockHistory = { replaceState: vi.fn() }
const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: false }
type Anchor = { dateKey: string; offset: number }
/** The store's rendered timetable, keyed by the inputs it was built from. */
const rendered = new Map<string, { groups: unknown[]; anchor: Anchor | null }>()
const keyedPeek = (key: string) => rendered.get(key)?.groups ?? null
const mockConcertService = {
	listFollowed: vi.fn(async () => []),
	revalidateFollower: vi.fn(async () => []),
	peekDateGroups: vi.fn(keyedPeek as (key: string) => unknown[] | null),
	setDateGroups: vi.fn((key: string, groups: unknown[]) => {
		rendered.set(key, { groups, anchor: rendered.get(key)?.anchor ?? null })
	}),
	toDateGroups: vi.fn(() => []),
	timetableAnchor: vi.fn((key: string) => rendered.get(key)?.anchor ?? null),
	saveTimetableAnchor: vi.fn((key: string, anchor: Anchor | null) => {
		const entry = rendered.get(key)
		if (entry) entry.anchor = anchor
	}),
}
const mockFollowStore = {
	followedArtists: [] as unknown[],
	followedIds: new Set<string>(),
	followedCount: 0,
	getFollowedArtistMap: vi.fn(async () => new Map()),
}
const mockJourneyStore = {
	journeyMap: new Map(),
	load: vi.fn(async () => new Map()),
	statusFor: vi.fn(() => undefined),
}
const mockPurchasedTickets = {
	countByEvent: new Map<string, number>(),
	load: vi.fn(async () => new Map<string, number>()),
}
const mockRouter = { load: vi.fn(async () => true) }
const mockResumeRevalidator = { register: vi.fn(), unregister: vi.fn() }
const mockFabMenu = { register: vi.fn(() => vi.fn()) }
const mockOnboarding = {
	isOnboarding: false,
	isCompleted: false,
	finish: vi.fn(),
}
const mockUserStore = {
	current: { home: 'JP-13' } as { home: string } | null,
	currentHome: 'JP-13' as string | null,
	guestHome: null,
	setGuestHome: vi.fn((code: string) => {
		mockUserStore.currentHome = code
	}),
}
const mockI18n = { tr: vi.fn((key: string) => key) }
const mockStorage = {
	getItem: vi.fn((_key: string): string | null => null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
}

/**
 * Stand-in for the timetable component. It owns the scroll container, so the
 * route saves and restores the fan's place through this API rather than by
 * querying another component's DOM.
 */
const ANCHOR = { dateKey: '2026-07-18', offset: 60 }
const mockHighway = {
	scrollAnchor: null as { dateKey: string; offset: number } | null,
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				IHistory: mockHistory,
				ILogger: mockLogger,
				IAuthService: mockAuth,
				IConcertStore: mockConcertService,
				IFollowStore: mockFollowStore,
				ITicketJourneyStore: mockJourneyStore,
				IPurchasedTicketStore: mockPurchasedTickets,
				IRouter: mockRouter,
				IResumeRevalidator: mockResumeRevalidator,
				IFabMenuService: mockFabMenu,
				IOnboardingService: mockOnboarding,
				IUserStore: mockUserStore,
				I18N: mockI18n,
				ILocalStorage: mockStorage,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
		// Flushes Aurelia's queued DOM writes. The route calls it before restoring
		// scroll, so a test can use it to model "the rows exist now".
		runTasks: vi.fn(),
	}
})

vi.mock('@aurelia/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/i18n')>()
	return { ...actual, I18N: { friendlyName: 'I18N' } }
})

vi.mock('@aurelia/router', () => ({
	RouteNode: class {},
	IRouter: { friendlyName: 'IRouter' },
}))
vi.mock('@aurelia/runtime', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/runtime')>()
	return { ...actual, queueTask: vi.fn((fn: () => void) => fn()) }
})
vi.mock('@aurelia/runtime-html', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/runtime-html')>()
	return { ...actual, watch: () => () => {} }
})

import { queueTask, runTasks } from 'aurelia'
import { todayCalendarDate } from '../../lib/plain-date'
import { ResumeRevalidator } from '../../services/resume-revalidator'
import { DashboardRoute } from './dashboard-route'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGroup(artistId: string, journeyStatus?: JourneyStatus): DateGroup {
	return {
		label: '4月1日(火)',
		dateKey: '2026-04-01',
		isFirstOfMonth: false,
		monthSeparatorLabel: '',
		home: [{ artistId, id: `h-${artistId}`, journeyStatus } as never],
		nearby: [],
		away: [],
	}
}

function makeArtist(id: string, name: string): Artist {
	return { id, name } as Artist
}

/** A one-group cached timetable, as ConcertStore.peekDateGroups() would return. */
function makeCachedGroups(dateKey = '2026-04-01'): DateGroup[] {
	return [
		{
			dateKey,
			label: '4/1',
			isFirstOfMonth: false,
			monthSeparatorLabel: '',
			home: [],
			nearby: [],
			away: [],
		},
	]
}

/** A loaded timetable of `count` distinct concerts, one per date group. */
function makeTimetable(count: number): DateGroup[] {
	return Array.from({ length: count }, (_, i) => makeGroup(`artist-${i}`))
}

/**
 * Make the next loads return a timetable of `count` concerts: listFollowed
 * yields a non-empty proto list, which toDateGroups turns into the groups.
 */
function primeTimetable(count: number): void {
	mockConcertService.listFollowed.mockResolvedValue(
		count > 0 ? [{}] : ([] as never),
	)
	mockConcertService.toDateGroups.mockReturnValue(makeTimetable(count) as never)
}

/** The key under which the route reads and writes its rendered timetable. */
function keyOf(route: DashboardRoute): string {
	return (route as unknown as { timetableKey(): string }).timetableKey()
}

/** Call the protected URL-sync watcher handler directly in unit tests. */
function syncFilterUrl(route: DashboardRoute): void {
	;(route as unknown as { syncFilterUrl(): void }).syncFilterUrl()
}

/** Call the protected journey-map watch handler directly in unit tests. */
function onJourneyMapChanged(
	route: DashboardRoute,
	map: Map<string, JourneyStatus>,
): void {
	;(
		route as unknown as {
			onJourneyMapChanged(m: Map<string, JourneyStatus>): void
		}
	).onJourneyMapChanged(map)
}

/** Read/write the private pendingConcertId deep-link target in unit tests. */
function setPendingConcertId(route: DashboardRoute, id: string | null): void {
	;(route as unknown as { pendingConcertId: string | null }).pendingConcertId =
		id
}
function getPendingConcertId(route: DashboardRoute): string | null {
	return (route as unknown as { pendingConcertId: string | null })
		.pendingConcertId
}

/** Invoke the private deep-link resolver directly in unit tests. */
function resolvePendingDeepLink(route: DashboardRoute): void {
	;(
		route as unknown as { resolvePendingDeepLink(): void }
	).resolvePendingDeepLink()
}

/** A detail sheet stub exposing only the open() spy the route calls. */
function stubDetailSheet(route: DashboardRoute): {
	open: ReturnType<typeof vi.fn>
} {
	const sheet = { open: vi.fn() }
	;(route as unknown as { detailSheet: unknown }).detailSheet = sheet
	return sheet
}

/** Let queued microtasks (fire-and-forget background refresh) settle. */
function flushMicrotasks(): Promise<void> {
	return new Promise((r) => setTimeout(r, 0))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardRoute', () => {
	let sut: DashboardRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockHighway.scrollAnchor = null
		rendered.clear()
		mockUserStore.currentHome = 'JP-13'
		mockFollowStore.followedIds = new Set()
		mockOnboarding.isOnboarding = false
		mockAuth.isAuthenticated = false
		mockFollowStore.followedArtists = []
		mockFollowStore.followedCount = 0
		mockStorage.getItem.mockReturnValue(null)
		mockConcertService.listFollowed.mockResolvedValue([])
		mockConcertService.toDateGroups.mockReturnValue([])
		mockConcertService.peekDateGroups.mockImplementation(keyedPeek)
		sut = new DashboardRoute()
	})

	describe('filteredDateGroups', () => {
		it('returns all groups when no filter is active', () => {
			sut.dateGroups = [makeGroup('artist-1'), makeGroup('artist-2')]
			sut.filteredArtistIds = []

			expect(sut.filteredDateGroups).toHaveLength(2)
		})

		it('returns only matching concerts for a single artist filter', () => {
			sut.dateGroups = [makeGroup('artist-1'), makeGroup('artist-2')]
			sut.filteredArtistIds = ['artist-1']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(1)
			expect(result[0].home[0].artistId).toBe('artist-1')
		})

		it('returns matching concerts for multiple artist IDs', () => {
			sut.dateGroups = [
				makeGroup('artist-1'),
				makeGroup('artist-2'),
				makeGroup('artist-3'),
			]
			sut.filteredArtistIds = ['artist-1', 'artist-3']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(2)
		})

		it('drops groups that become empty after filtering', () => {
			sut.dateGroups = [makeGroup('artist-1')]
			sut.filteredArtistIds = ['unknown-id']

			expect(sut.filteredDateGroups).toHaveLength(0)
		})

		it('silently ignores unknown artist IDs and shows remaining matches', () => {
			sut.dateGroups = [makeGroup('artist-1'), makeGroup('artist-2')]
			sut.filteredArtistIds = ['artist-1', 'unknown-id']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(1)
			expect(result[0].home[0].artistId).toBe('artist-1')
		})
	})

	describe('filteredDateGroups — journey facet', () => {
		it('keeps only concerts whose status is in the journey filter', () => {
			sut.dateGroups = [makeGroup('a1', 'applied'), makeGroup('a2', 'paid')]
			sut.filteredStatuses = ['applied']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(1)
			expect(result[0].home[0].journeyStatus).toBe('applied')
		})

		it('combines multiple statuses as OR', () => {
			sut.dateGroups = [
				makeGroup('a1', 'applied'),
				makeGroup('a2', 'unpaid'),
				makeGroup('a3', 'paid'),
			]
			sut.filteredStatuses = ['applied', 'unpaid']

			expect(sut.filteredDateGroups).toHaveLength(2)
		})

		it('excludes concerts with no status set while filtering', () => {
			sut.dateGroups = [makeGroup('a1', 'applied'), makeGroup('a2')]
			sut.filteredStatuses = ['applied']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(1)
			expect(result[0].home[0].artistId).toBe('a1')
		})

		it('applies artist AND journey facets together', () => {
			sut.dateGroups = [
				makeGroup('a1', 'applied'),
				makeGroup('a1', 'paid'),
				makeGroup('a2', 'applied'),
			]
			sut.filteredArtistIds = ['a1']
			sut.filteredStatuses = ['applied']

			const result = sut.filteredDateGroups
			expect(result).toHaveLength(1)
			expect(result[0].home[0].artistId).toBe('a1')
			expect(result[0].home[0].journeyStatus).toBe('applied')
		})

		it('strips blank-artistId concerts even under a journey filter', () => {
			sut.dateGroups = [makeGroup('', 'applied')]
			sut.filteredStatuses = ['applied']

			expect(sut.filteredDateGroups).toHaveLength(0)
		})
	})

	describe('countedArtists', () => {
		it('counts over the unfiltered set, hides zero, sorts by count then name', () => {
			mockFollowStore.followedArtists = [
				makeArtist('a1', 'Beta'),
				makeArtist('a2', 'Alpha'),
				makeArtist('a3', 'Gamma'),
				makeArtist('a4', 'Zero'),
			]
			sut.dateGroups = [
				makeGroup('a1'),
				makeGroup('a2'),
				makeGroup('a2'),
				makeGroup('a3'),
			]
			// a4 has no concerts → hidden; a2 has 2 → first; a1 & a3 tie at 1 → name asc
			expect(sut.countedArtists).toEqual([
				{ id: 'a2', name: 'Alpha', count: 2 },
				{ id: 'a1', name: 'Beta', count: 1 },
				{ id: 'a3', name: 'Gamma', count: 1 },
			])
		})

		it('keeps counts stable over the unfiltered set while a filter is active', () => {
			mockFollowStore.followedArtists = [
				makeArtist('a1', 'One'),
				makeArtist('a2', 'Two'),
			]
			sut.dateGroups = [makeGroup('a1'), makeGroup('a2')]
			sut.filteredArtistIds = ['a1']

			const counts = sut.countedArtists
			expect(counts).toHaveLength(2)
			expect(counts.find((a) => a.id === 'a2')?.count).toBe(1)
		})
	})

	describe('loadData() fast-path (warm re-entry)', () => {
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "A cached result is reflected from the component lifecycle"
		it('parks the cache in loading() and reflects it from bound(), before the first render', async () => {
			const cached = makeCachedGroups()
			mockConcertService.peekDateGroups.mockReturnValue(cached)
			sut.needsRegion = false

			await sut.loadData()

			// loadData() is reached from the pre-activation loading() hook, which
			// must not assign render state.
			expect(sut.dateGroups).toEqual([])
			// Not settled yet, so the template shows the skeleton — NOT an empty
			// state, which `dateGroups.length === 0` alone cannot distinguish.
			expect(sut.hasSettled).toBe(false)
			// The spinner is never raised on this path — that invariant is unchanged,
			// and it is why the skeleton cannot be gated on isLoading.
			expect(sut.isLoading).toBe(false)

			// bound() is a component-lifecycle hook that runs before the first
			// render, so re-entry renders the timetable directly — no skeleton first,
			// and nothing forced to flush.
			sut.bound()

			expect(sut.dateGroups).toEqual(cached)
			expect(sut.hasSettled).toBe(true)
			expect(sut.isLoading).toBe(false)
			expect(runTasks).not.toHaveBeenCalled()
		})

		it('never renders an empty state while a cached paint is pending', async () => {
			mockConcertService.peekDateGroups.mockReturnValue(makeCachedGroups())
			sut.needsRegion = false

			await sut.loadData()

			// Both empty-state placeholders are gated on hasSettled, so nothing can
			// flash an empty state between loading() and bound().
			expect(sut.hasSettled).toBe(false)
			expect(sut.dateGroups).toEqual([])
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Cache hit on Dashboard re-entry"
		it('reads the concert list through the cached read on warm re-entry, without forcing a refetch', async () => {
			mockConcertService.peekDateGroups.mockReturnValue(makeCachedGroups())
			sut.needsRegion = false

			await sut.loadData()

			// refreshInBackground() bails on `isLoading`, so driving the skeleton from
			// isLoading instead of hasSettled would silently stop re-entry refreshing.
			expect(mockConcertService.listFollowed).toHaveBeenCalled()
			// Re-entry within the stale window is served from the store's cache; only
			// PWA resume forces a ListFollowed refetch.
			expect(mockConcertService.revalidateFollower).not.toHaveBeenCalled()
		})

		it('does not clobber fresher groups that landed before the cache was reflected', async () => {
			const cached = makeCachedGroups('2026-04-01')
			const fresh = makeCachedGroups('2026-05-05')
			mockConcertService.peekDateGroups.mockReturnValue(cached)
			mockConcertService.toDateGroups.mockReturnValue(fresh)
			mockConcertService.listFollowed.mockResolvedValue([{}])
			sut.needsRegion = false

			await sut.loadData()
			// The refresh is fire-and-forget; letting it settle before bound()
			// models the fast-network case. Reflecting the cache afterwards would
			// replace fresh data with stale.
			await flushMicrotasks()

			sut.bound()

			expect(sut.dateGroups).toEqual(fresh)
		})

		it('saves the anchor on the way out and hands it to the highway on re-entry', async () => {
			mockConcertService.setDateGroups(keyOf(sut), makeCachedGroups())
			sut.needsRegion = false

			// The fan scrolls deep, then leaves. `unloading` runs while the view is
			// still in the DOM, which is why the anchor can be read at all.
			sut.highway = mockHighway as never
			mockHighway.scrollAnchor = ANCHOR
			sut.unloading()
			expect(mockConcertService.timetableAnchor(keyOf(sut))).toEqual(ANCHOR)

			// Coming back: a NEW route instance, which is why the anchor has to live
			// in the store rather than on the route. The highway receives it as its
			// initial anchor, builds its window around it and positions itself in
			// its own attached() — the route no longer restores anything.
			const next = new DashboardRoute()
			await next.loadData()
			next.bound()

			expect(next.timetableAnchor).toEqual(ANCHOR)
			expect(next.dateGroups).toEqual(makeCachedGroups())
		})

		it('hands no anchor over on a first visit', async () => {
			mockConcertService.setDateGroups(keyOf(sut), makeCachedGroups())
			sut.needsRegion = false

			await sut.loadData()
			sut.bound()

			expect(sut.timetableAnchor).toBeNull()
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Deferring the render preserves load-path side effects"
		it('keeps the refresh, the data-ready latch and a pending deep-link when reflecting in bound()', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			sut = new DashboardRoute()
			sut.needsRegion = false
			const onLoaded = vi.spyOn(
				sut as unknown as { timetableLoadedChanged: (v: boolean) => void },
				'timetableLoadedChanged',
			)
			mockConcertService.peekDateGroups.mockReturnValueOnce([
				makeGroup('artist-9'),
			])
			mockConcertService.listFollowed.mockResolvedValueOnce([{}] as never)
			mockConcertService.toDateGroups.mockReturnValueOnce([
				makeGroup('artist-1'),
			])
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-1')

			await sut.loadData()
			sut.bound()
			// The data-ready latch fires once, from the lifecycle reflection.
			expect(sut.timetableLoaded).toBe(true)
			expect(onLoaded).toHaveBeenCalledTimes(1)
			expect(sheet.open).not.toHaveBeenCalled()

			await flushMicrotasks()
			// The background refresh still fetched and swapped in fresh data, and
			// the deep-link resolved against it.
			expect(mockConcertService.listFollowed).toHaveBeenCalled()
			expect(sut.dateGroups).toEqual([makeGroup('artist-1')])
			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(onLoaded).toHaveBeenCalledTimes(1)
		})

		it('falls through to cold load when no cache exists (first visit)', () => {
			mockConcertService.peekDateGroups.mockReturnValue(null)
			sut.needsRegion = false

			mockConcertService.listFollowed.mockReturnValueOnce(new Promise(() => {}))
			void sut.loadData()

			expect(sut.isLoading).toBe(true)
		})
	})

	describe('loadData() cold load — loading and empty states', () => {
		it('stays unsettled while loading, then settles with no groups', async () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Loading and empty states"
			mockConcertService.peekDateGroups.mockReturnValue(null)
			mockConcertService.toDateGroups.mockReturnValue([])
			let release: (v: never[]) => void = () => {}
			mockConcertService.listFollowed.mockReturnValueOnce(
				new Promise((r) => {
					release = r
				}),
			)
			sut.needsRegion = false

			const load = sut.loadData()

			// Loading: the highway's loading placeholder is bound to !hasSettled,
			// and both empty states are gated on hasSettled.
			expect(sut.hasSettled).toBe(false)

			release([])
			await load

			// Settled with nothing to show: the empty state (with its Discovery
			// link) renders.
			expect(sut.hasSettled).toBe(true)
			expect(sut.loadError).toBeNull()
			expect(sut.filteredDateGroups).toEqual([])
		})
	})

	describe('journey write-through consistency (onJourneyMapChanged)', () => {
		it('re-stamps concert journeyStatus from the store map without a re-fetch', () => {
			// makeGroup uses id `h-${artistId}`; seed with no status, then simulate a
			// detail-sheet write landing in the store map.
			sut.dateGroups = [makeGroup('a1'), makeGroup('a2')]
			expect(sut.dateGroups[0].home[0].journeyStatus).toBeUndefined()

			onJourneyMapChanged(
				sut,
				new Map<JourneyStatus | string, JourneyStatus>([
					['h-a1', 'applied'],
				]) as Map<string, JourneyStatus>,
			)

			// The dashboard reflects the sheet's write in place; no listFollowed call.
			expect(sut.dateGroups[0].home[0].journeyStatus).toBe('applied')
			expect(sut.dateGroups[1].home[0].journeyStatus).toBeUndefined()
			expect(mockConcertService.listFollowed).not.toHaveBeenCalled()
		})

		it('clears a stamped status when the store entry is removed', () => {
			sut.dateGroups = [makeGroup('a1', 'applied')]

			onJourneyMapChanged(sut, new Map())

			expect(sut.dateGroups[0].home[0].journeyStatus).toBeUndefined()
		})
	})

	describe('syncFilterUrl', () => {
		it('replaces URL to /dashboard when both facets are empty', () => {
			sut.filteredArtistIds = []
			sut.filteredStatuses = []
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard',
			)
		})

		it('writes the artists param only', () => {
			sut.filteredArtistIds = ['id-1', 'id-2']
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?artists=id-1,id-2',
			)
		})

		it('writes the journey param only', () => {
			sut.filteredStatuses = ['applied', 'unpaid']
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?journey=applied,unpaid',
			)
		})

		it('writes both params in a single replaceState', () => {
			sut.filteredArtistIds = ['id-1']
			sut.filteredStatuses = ['applied', 'unpaid']
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledTimes(1)
			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?artists=id-1&journey=applied,unpaid',
			)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Collapsing back to today onward"
		it('omits the from param when the date is the today-onward default', () => {
			// fromDate defaults to today at construction → no `from` param.
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard',
			)
		})

		it('writes the from param for a non-default (past) date', () => {
			sut.fromDate = { year: 2020, month: 1, day: 1 }
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?from=2020-01-01',
			)
		})

		it('writes artists, journey, and from together in one replaceState', () => {
			sut.filteredArtistIds = ['id-1']
			sut.filteredStatuses = ['applied']
			sut.fromDate = { year: 2020, month: 1, day: 1 }
			syncFilterUrl(sut)

			expect(mockHistory.replaceState).toHaveBeenCalledTimes(1)
			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?artists=id-1&journey=applied&from=2020-01-01',
			)
		})
	})

	describe('date filter — from param + re-fetch', () => {
		/** Let the fire-and-forget loadData() reach the concert fetch. */
		const flushLoad = () => new Promise((r) => setTimeout(r, 0))

		function makeRouteNode(fromParam: string | null) {
			return {
				queryParams: {
					get: (key: string) => (key === 'from' ? fromParam : null),
				},
			} as never
		}

		// @spec components/infrastructure/fan/web/route/dashboard "Past date from URL"
		it('restores fromDate from a valid ?from param', async () => {
			await sut.loading({}, makeRouteNode('2020-01-01'))
			await flushLoad()

			expect(sut.fromDate).toEqual({ year: 2020, month: 1, day: 1 })
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				{ year: 2020, month: 1, day: 1 },
				expect.anything(),
			)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Fresh load defaults to today onward"
		it('requests ListFollowed from the client local date when no ?from is given', async () => {
			mockConcertService.listFollowed.mockClear()
			await sut.loading({}, makeRouteNode(null))
			await flushLoad()

			expect(sut.fromDate).toEqual(todayCalendarDate())
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				todayCalendarDate(),
				expect.anything(),
			)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Future date from URL"
		it('requests ListFollowed from a future ?from date', async () => {
			mockConcertService.listFollowed.mockClear()
			await sut.loading({}, makeRouteNode('2099-12-31'))
			await flushLoad()

			expect(sut.fromDate).toEqual({ year: 2099, month: 12, day: 31 })
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				{ year: 2099, month: 12, day: 31 },
				expect.anything(),
			)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Invalid or malformed date value"
		it('falls back to today when the ?from value is malformed', async () => {
			await sut.loading({}, makeRouteNode('not-a-date'))

			// Malformed → default today-onward, so no from param round-trips out.
			expect(
				(sut as unknown as { isDefaultFrom(): boolean }).isDefaultFrom(),
			).toBe(true)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Choosing a past date and confirming"
		it('re-fetches ListFollowed with the new from on a date change', () => {
			// The timetable of the current window is in the session cache.
			sut.needsRegion = false
			mockConcertService.setDateGroups(keyOf(sut), makeCachedGroups())
			mockConcertService.listFollowed.mockClear()
			const past = { year: 2020, month: 1, day: 1 }

			;(
				sut as unknown as {
					onDateFilterChanged(e: CustomEvent<typeof past>): void
				}
			).onDateFilterChanged(new CustomEvent('date-changed', { detail: past }))

			expect(sut.fromDate).toEqual(past)
			// The timetable rendered for the previous window is not repainted.
			expect(sut.isLoading).toBe(true)
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				past,
				expect.anything(),
			)
		})

		it('ignores a date change that matches the active from (no re-fetch)', () => {
			const same = sut.fromDate
			mockConcertService.listFollowed.mockClear()

			;(
				sut as unknown as {
					onDateFilterChanged(e: CustomEvent<typeof same>): void
				}
			).onDateFilterChanged(new CustomEvent('date-changed', { detail: same }))

			expect(mockConcertService.listFollowed).not.toHaveBeenCalled()
		})
	})

	describe('loading() — query param parsing', () => {
		function makeRouteNode(
			artistsParam: string | null,
			journeyParam: string | null = null,
		) {
			return {
				queryParams: {
					get: (key: string) => {
						if (key === 'artists') return artistsParam
						if (key === 'journey') return journeyParam
						return null
					},
				},
			} as never
		}

		it('sets filteredArtistIds from ?artists query param', async () => {
			await sut.loading({}, makeRouteNode('id-1,id-2'))

			expect(sut.filteredArtistIds).toEqual(['id-1', 'id-2'])
		})

		it('sets empty array when artists param is absent', async () => {
			await sut.loading({}, makeRouteNode(null))

			expect(sut.filteredArtistIds).toEqual([])
		})

		it('ignores artists param when onboarding is active', async () => {
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()

			await sut.loading({}, makeRouteNode('id-1,id-2'))

			expect(sut.filteredArtistIds).toEqual([])
		})

		it('parses the ?journey param for authenticated users', async () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()

			await sut.loading({}, makeRouteNode(null, 'applied,unpaid'))

			expect(sut.filteredStatuses).toEqual(['applied', 'unpaid'])
		})

		it('drops unknown journey tokens, keeping valid ones', async () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()

			await sut.loading({}, makeRouteNode(null, 'applied,bogus,paid'))

			expect(sut.filteredStatuses).toEqual(['applied', 'paid'])
		})

		it('ignores the ?journey param for guests (no effect)', async () => {
			mockAuth.isAuthenticated = false
			sut = new DashboardRoute()

			await sut.loading({}, makeRouteNode(null, 'applied,unpaid'))

			expect(sut.filteredStatuses).toEqual([])
		})
	})

	describe('deep-link auto-open (/concerts/:id)', () => {
		function makeRouteNode() {
			return { queryParams: { get: () => null } } as never
		}

		it('records the :id route param as the pending deep-link target', async () => {
			await sut.loading({ id: 'h-artist-1' }, makeRouteNode())

			expect(getPendingConcertId(sut)).toBe('h-artist-1')
		})

		it('ignores the :id param during onboarding', async () => {
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()

			await sut.loading({ id: 'h-artist-1' }, makeRouteNode())

			expect(getPendingConcertId(sut)).toBeNull()
		})

		it('opens the sheet and derives the artist filter when the concert resolves', async () => {
			sut.dateGroups = [makeGroup('artist-1'), makeGroup('artist-2')]
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-2')

			resolvePendingDeepLink(sut)
			await flushMicrotasks()

			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(sheet.open).toHaveBeenCalledWith(sut.dateGroups[1].home[0])
			expect(sut.filteredArtistIds).toEqual(['artist-2'])
		})

		it('degrades to no-op (no sheet, no filter, no error) when the concert is absent', () => {
			sut.dateGroups = [makeGroup('artist-1')]
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'missing-id')

			expect(() => resolvePendingDeepLink(sut)).not.toThrow()

			expect(sheet.open).not.toHaveBeenCalled()
			expect(sut.filteredArtistIds).toEqual([])
		})

		it('self-clears so a later resolve pass never re-opens the sheet', async () => {
			sut.dateGroups = [makeGroup('artist-1')]
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-1')

			resolvePendingDeepLink(sut)
			resolvePendingDeepLink(sut)
			await flushMicrotasks()

			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(getPendingConcertId(sut)).toBeNull()
		})

		it('opens the sheet behind tasks already queued, without a synchronous flush', async () => {
			sut.dateGroups = [makeGroup('artist-1')]
			const order: string[] = []
			const sheet = stubDetailSheet(sut)
			sheet.open.mockImplementation(() => order.push('sheet'))
			setPendingConcertId(sut, 'h-artist-1')

			// Stands in for the filter's URL write, which its @watch queues when
			// the filter is assigned: it must run before the sheet pushes its URL.
			queueTask(() => order.push('filter-url'))
			resolvePendingDeepLink(sut)
			// Nothing is flushed synchronously: on a slow device a flush of the
			// filtered timetable's render exceeded the 100 ms budget, threw, and
			// dropped every queued task.
			expect(runTasks).not.toHaveBeenCalled()
			expect(sheet.open).not.toHaveBeenCalled()

			await flushMicrotasks()
			expect(order).toEqual(['filter-url', 'sheet'])
		})

		it('resolves against the authoritative cold-load fetch', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			sut = new DashboardRoute()
			sut.needsRegion = false

			mockConcertService.peekDateGroups.mockReturnValueOnce(null)
			mockConcertService.listFollowed.mockResolvedValueOnce([{}] as never)
			mockConcertService.toDateGroups.mockReturnValueOnce([
				makeGroup('artist-1'),
			])
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-1')

			await sut.loadData()

			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(sut.filteredArtistIds).toEqual(['artist-1'])
		})

		it('resolves on the background fetch, not the cache first-paint', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			sut = new DashboardRoute()
			sut.needsRegion = false

			// Cache paint has no matching concert; the authoritative refresh does.
			mockConcertService.peekDateGroups.mockReturnValueOnce([
				makeGroup('artist-9'),
			])
			mockConcertService.listFollowed.mockResolvedValueOnce([{}] as never)
			mockConcertService.toDateGroups.mockReturnValueOnce([
				makeGroup('artist-1'),
			])
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-1')

			await sut.loadData()
			// Cache painted, but the deep-link must NOT resolve off it.
			expect(sheet.open).not.toHaveBeenCalled()

			await flushMicrotasks()
			// The background fetch settled with the concert present → sheet opens.
			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(sut.filteredArtistIds).toEqual(['artist-1'])
		})
	})

	describe('maybeCelebrate (via observed data arrival / onHomeSelected)', () => {
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Guest light celebration on first dashboard"
		it('shows the guest light celebration (no confetti) with the follow and concert counts', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			primeTimetable(12)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(false)
			expect(sut.celebrationMessage).toBe('dashboard.celebration.complete')
			expect(mockI18n.tr).toHaveBeenCalledWith('dashboard.celebration.found', {
				artists: 5,
				concerts: 12,
			})
			expect(sut.celebrationHint).toBe('dashboard.celebration.tapToView')
			// The one-shot flag is NOT burned while merely deciding to show the
			// overlay — it is set only when the overlay actually opens (Fix 2).
			expect(mockStorage.setItem).not.toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)
		})

		it('persists the one-shot flag for a guest only once the overlay opens', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 1
			primeTimetable(1)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()
			expect(mockStorage.setItem).not.toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)

			sut.onCelebrationOpened()

			expect(mockStorage.setItem).toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)
		})

		it('does not burn the one-shot flag when the overlay is suppressed', async () => {
			// A suppressed overlay (never opened) must leave the flag untouched so the
			// celebration can still appear on a later eligible arrival.
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = false
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
			expect(mockStorage.setItem).not.toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)
		})

		it('does not persist the flag on overlay open for an authenticated user', () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()

			sut.onCelebrationOpened()

			expect(mockStorage.setItem).not.toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "No light celebration for a completed guest revisiting the dashboard"
		it('does not show the light celebration for a completed guest (not onboarding)', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = false
			mockFollowStore.followedCount = 5
			primeTimetable(12)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Celebration does not replay"
		it('does not replay the guest light celebration once shown', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			primeTimetable(12)
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'onboarding.celebrationShown' ? '1' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Celebration gated on timetable readiness"
		it('defers the celebration while a region is still needed', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			primeTimetable(12)
			sut = new DashboardRoute()
			sut.needsRegion = true

			// Even though data arrives, the gated handler must not celebrate over a
			// region-less (blurred) timetable.
			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Celebration gated on timetable readiness"
		it('celebrates after the region is selected', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			primeTimetable(12)
			sut = new DashboardRoute()
			sut.needsRegion = true
			sut.attached()
			expect(sut.showCelebration).toBe(false)

			await sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).toHaveBeenCalledWith('JP-13')
			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Post-signup full celebration then dialog"
		// @spec components/infrastructure/fan/web/global/celebration-overlay "Existing celebration behavior is preserved"
		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Dialog opens after celebration dismissal"
		it('shows the post-signup full celebration (confetti) then the dialog', async () => {
			mockAuth.isAuthenticated = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'postSignup.shown' ? 'pending' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(true)
			expect(sut.celebrationMessage).toBe('dashboard.celebration.welcome')
			expect(sut.celebrationSubMessage).toBe('dashboard.celebration.chasing')
			expect(mockStorage.removeItem).toHaveBeenCalledWith('postSignup.shown')
			expect(sut.showPostSignupDialog).toBe(false)

			sut.onCelebrationDismissed()

			expect(sut.showCelebration).toBe(false)
			expect(sut.showPostSignupDialog).toBe(true)
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "Follows but no concert yet"
		it('does not show the light celebration when the timetable holds no concert', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 3
			primeTimetable(0)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
			// The empty state guides instead: the load settled with no groups.
			expect(sut.hasSettled).toBe(true)
			expect(sut.dateGroups).toEqual([])
		})

		// @spec components/infrastructure/fan/web/global/celebration-overlay "No follows"
		it('does not show the light celebration for a guest with no follow', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 0
			primeTimetable(4)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		it('counts a concert listed in several lanes once', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 1
			const concert = { artistId: 'a', id: 'c-1' } as never
			mockConcertService.listFollowed.mockResolvedValue([{}] as never)
			mockConcertService.toDateGroups.mockReturnValue([
				{ ...makeGroup('a'), home: [concert], nearby: [concert] },
			] as never)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockI18n.tr).toHaveBeenCalledWith('dashboard.celebration.found', {
				artists: 1,
				concerts: 1,
			})
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Home area chosen on arrival, timetable served from session data"
		// @spec stories/complete-onboarding "Completion latches after choosing the home area on arrival"
		it('decides the celebration and the latch once, on the timetable for the chosen home area', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			mockFollowStore.followedIds = new Set(['a', 'b', 'c', 'd', 'e'])
			mockUserStore.currentHome = null
			sut = new DashboardRoute()
			const celebrate = vi.spyOn(
				sut as unknown as { maybeCelebrate(): void },
				'maybeCelebrate',
			)
			const latch = vi.spyOn(
				sut as unknown as { maybeFinishOnboarding(): void },
				'maybeFinishOnboarding',
			)
			// First arrival: no home area yet, so the timetable built now has no
			// concert to show; it lands in the session cache under its own key.
			primeTimetable(0)
			sut.needsRegion = true
			await sut.loadData()
			sut.attached()
			expect(celebrate).not.toHaveBeenCalled()

			// Choosing Tokyo changes the inputs, so the cached empty timetable is
			// not painted; the timetable for Tokyo is, and it has 12 concerts. Its
			// concert list was already fetched in the session (the RPC cache).
			primeTimetable(12)
			await sut.onHomeSelected('JP-13')

			expect(celebrate).toHaveBeenCalledTimes(1)
			expect(latch).toHaveBeenCalledTimes(1)
			expect(sut.showCelebration).toBe(true)
			expect(mockI18n.tr).toHaveBeenCalledWith('dashboard.celebration.found', {
				artists: 5,
				concerts: 12,
			})
			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		it('repaints the cached timetable for unchanged inputs and celebrates on it', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 5
			mockFollowStore.followedIds = new Set(['a'])
			mockConcertService.setDateGroups(keyOf(sut), makeTimetable(4))
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()
			sut.bound()

			expect(sut.showCelebration).toBe(true)
			expect(mockI18n.tr).toHaveBeenCalledWith('dashboard.celebration.found', {
				artists: 5,
				concerts: 4,
			})
		})

		it('never paints a timetable built for another follow set', async () => {
			mockFollowStore.followedIds = new Set(['a'])
			mockConcertService.setDateGroups(keyOf(sut), makeCachedGroups())
			mockFollowStore.followedIds = new Set(['a', 'b'])
			mockConcertService.listFollowed.mockReturnValueOnce(new Promise(() => {}))
			sut = new DashboardRoute()
			sut.needsRegion = false

			void sut.loadData()
			sut.bound()

			expect(sut.isLoading).toBe(true)
			expect(sut.dateGroups).toEqual([])
		})

		it('does not celebrate for an authenticated returning user', async () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Celebration fires only once the timetable is real"
		it('does not celebrate over a still-loading timetable (data not yet arrived)', () => {
			mockAuth.isAuthenticated = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'postSignup.shown' ? 'pending' : null,
			)
			// Fetch never resolves → timetableLoaded never flips.
			mockConcertService.listFollowed.mockReturnValueOnce(new Promise(() => {}))
			sut = new DashboardRoute()
			sut.needsRegion = false

			void sut.loadData()
			sut.attached()

			expect(sut.isLoading).toBe(true)
			expect(sut.showCelebration).toBe(false)
		})
	})

	describe('completion latch (finish via observed data arrival / onHomeSelected)', () => {
		// @spec stories/complete-onboarding "Completion latches on first meaningful dashboard arrival"
		it('latches finish() on a meaningful first arrival (region set, data loaded, followedCount >= 1)', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 1
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		// @spec stories/complete-onboarding "Latch is independent of whether the celebration is shown"
		it('still latches when the celebration is suppressed (celebrationShown === "1")', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 3
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'onboarding.celebrationShown' ? '1' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			// Celebration is suppressed but the latch is driven by data-ready +
			// engaged, not by the overlay rendering.
			expect(sut.showCelebration).toBe(false)
			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		// @spec stories/complete-onboarding "No latch for a zero-follow dashboard arrival"
		// @spec stories/complete-onboarding "Latch is independent of whether the celebration is shown"
		it('still latches when the timetable holds no concert to celebrate', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 2
			primeTimetable(0)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

		it('does NOT latch on a zero-follow arrival', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 0
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/dashboard "Completion latch waits for engagement data"
		it('does NOT latch while the load is still in flight (data not yet arrived)', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 2
			mockConcertService.listFollowed.mockReturnValueOnce(new Promise(() => {}))
			sut = new DashboardRoute()
			sut.needsRegion = false

			void sut.loadData()

			expect(sut.isLoading).toBe(true)
			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does NOT latch while a region is still needed; celebration sequenced before latch on region select', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 2
			primeTimetable(3)
			sut = new DashboardRoute()
			sut.needsRegion = true

			sut.attached()
			// region-less guest: no latch yet, but the light celebration is deferred
			expect(mockOnboarding.finish).not.toHaveBeenCalled()

			await sut.onHomeSelected('JP-13')

			// celebration still shows (region-less guest sees it before latch)
			expect(sut.showCelebration).toBe(true)
			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})
	})
	describe('PWA resume revalidation', () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Revalidation on PWA resume"
		it('forces a ListFollowed refetch on foreground return and swaps the fresh timetable in place', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			// The real app-level visibility hook, so the resume signal is the
			// browser's `visibilitychange` event rather than a direct call.
			const resume = new ResumeRevalidator()
			mockResumeRevalidator.register.mockImplementation((fn: () => void) =>
				resume.register(fn),
			)
			mockResumeRevalidator.unregister.mockImplementation((fn: () => void) =>
				resume.unregister(fn),
			)
			const cached = makeCachedGroups('2026-04-01')
			const fresh = makeCachedGroups('2026-05-05')
			mockConcertService.peekDateGroups.mockReturnValue(cached)
			mockConcertService.listFollowed.mockResolvedValue([{}] as never)
			mockConcertService.toDateGroups.mockReturnValue(cached)
			sut = new DashboardRoute()
			sut.needsRegion = false

			try {
				// Dashboard entry: the cached timetable is on screen.
				await sut.loadData()
				sut.bound()
				sut.attached()
				await flushMicrotasks()
				expect(sut.dateGroups).toEqual(cached)

				mockConcertService.listFollowed.mockClear()
				mockConcertService.setDateGroups.mockClear()
				mockConcertService.revalidateFollower.mockResolvedValueOnce([
					{},
				] as never)
				mockConcertService.toDateGroups.mockReturnValue(fresh)

				// The installed PWA returns to the foreground.
				document.dispatchEvent(new Event('visibilitychange'))
				await flushMicrotasks()

				// Revalidated, not served from the 24h cache.
				expect(mockConcertService.revalidateFollower).toHaveBeenCalledTimes(1)
				expect(mockConcertService.revalidateFollower).toHaveBeenCalledWith(
					sut.fromDate,
				)
				expect(mockConcertService.listFollowed).not.toHaveBeenCalled()
				// The refreshed value replaces the cached one in place: same route
				// instance, no spinner, and the store's cached groups updated.
				expect(sut.dateGroups).toEqual(fresh)
				expect(sut.isLoading).toBe(false)
				expect(sut.hasSettled).toBe(true)
				expect(mockConcertService.setDateGroups).toHaveBeenCalledWith(
					keyOf(sut),
					fresh,
				)
			} finally {
				sut.detaching()
				mockResumeRevalidator.register.mockReset()
				mockResumeRevalidator.unregister.mockReset()
			}
		})
	})

	describe('default timetable — empty upcoming', () => {
		// @spec components/infrastructure/fan/web/route/dashboard "Empty upcoming timetable"
		it('shows the empty state and keeps the filter sheet (with its date facet) reachable', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			mockConcertService.peekDateGroups.mockReturnValue(null)
			mockConcertService.listFollowed.mockResolvedValue([])
			sut = new DashboardRoute()
			const filterBar = { openSheet: vi.fn(), isFilterActive: false }
			;(sut as unknown as { filterBar: unknown }).filterBar = filterBar

			await sut.loading({}, {
				queryParams: { get: () => null },
			} as never)
			await flushMicrotasks()

			// Default (today-onward) view with no upcoming concerts.
			expect(sut.fromDate).toEqual(todayCalendarDate())
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				todayCalendarDate(),
				expect.anything(),
			)
			// The template's empty-state placeholder gate:
			// hasSettled && !loadError && !showGuestEmptyState && filteredDateGroups.length === 0
			expect(sut.hasSettled).toBe(true)
			expect(sut.loadError).toBeNull()
			expect(sut.showGuestEmptyState).toBe(false)
			expect(sut.filteredDateGroups).toEqual([])

			// The filter sheet (which holds "過去のコンサートも表示") stays mounted —
			// its gate is `!isOnboarding && !isAllNearby` — and the FAB still offers
			// the filter action that opens it.
			expect(sut.isOnboarding).toBe(false)
			expect(sut.isAllNearby).toBe(false)
			sut.attached()
			const calls = mockFabMenu.register.mock.calls as unknown as [
				unknown,
				{ id: string; invoke: () => void }[],
			][]
			const actions = calls[calls.length - 1]?.[1]
			const filter = actions?.find((a) => a.id === 'filter')
			expect(filter).toBeDefined()
			filter?.invoke()
			expect(filterBar.openSheet).toHaveBeenCalledTimes(1)
			sut.detaching()
		})
	})

	describe('date facet with artist and journey facets', () => {
		function pastGroup(
			dateKey: string,
			concerts: { artistId: string; journeyStatus?: JourneyStatus }[],
		): DateGroup {
			return {
				label: dateKey,
				dateKey,
				isFirstOfMonth: false,
				monthSeparatorLabel: '',
				home: concerts.map(
					(c, i) =>
						({
							artistId: c.artistId,
							id: `${dateKey}-${c.artistId}-${i}`,
							journeyStatus: c.journeyStatus,
						}) as never,
				),
				nearby: [],
				away: [],
			}
		}

		// @spec components/infrastructure/fan/web/route/dashboard "Date facet combines with artist and journey facets"
		it('loads every concert from the past from date, then narrows by artist and journey; counts span the loaded set', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			mockFollowStore.followedArtists = [
				makeArtist('a1', 'One'),
				makeArtist('a2', 'Two'),
			]
			mockConcertService.peekDateGroups.mockReturnValue(null)
			mockConcertService.listFollowed.mockResolvedValue([{}] as never)
			// The loaded, past-inclusive set: a past and an upcoming date.
			const loaded = [
				pastGroup('2020-03-01', [
					{ artistId: 'a1', journeyStatus: 'applied' },
					{ artistId: 'a2', journeyStatus: 'applied' },
				]),
				pastGroup('2099-01-01', [
					{ artistId: 'a1', journeyStatus: 'paid' },
					{ artistId: 'a1', journeyStatus: 'applied' },
				]),
			]
			mockConcertService.toDateGroups.mockReturnValue(loaded)
			sut = new DashboardRoute()
			const params: Record<string, string> = {
				from: '2020-01-01',
				artists: 'a1',
				journey: 'applied',
			}

			await sut.loading({}, {
				queryParams: { get: (k: string) => params[k] ?? null },
			} as never)
			await flushMicrotasks()

			// First: load all followed-artist concerts on or after `from`.
			expect(mockConcertService.listFollowed).toHaveBeenCalledWith(
				{ year: 2020, month: 1, day: 1 },
				expect.anything(),
			)
			expect(sut.dateGroups).toEqual(loaded)

			// Then: narrow that set by the artist AND journey facets.
			const shown = sut.filteredDateGroups.flatMap((g) => g.home)
			expect(shown.map((c) => [c.artistId, c.journeyStatus])).toEqual([
				['a1', 'applied'],
				['a1', 'applied'],
			])
			expect(sut.filteredDateGroups.map((g) => g.dateKey)).toEqual([
				'2020-03-01',
				'2099-01-01',
			])

			// Per-artist chip counts are computed over the loaded (past-inclusive)
			// set, not the narrowed one.
			expect(sut.countedArtists).toEqual([
				{ id: 'a1', name: 'One', count: 3 },
				{ id: 'a2', name: 'Two', count: 1 },
			])
		})
	})
})
