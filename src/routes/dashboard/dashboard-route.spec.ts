import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../entities/artist'
import type { DateGroup, JourneyStatus } from '../../entities/concert'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockHistory = { replaceState: vi.fn() }
const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: false }
const mockConcertService = {
	listByFollower: vi.fn(async () => []),
	revalidateFollower: vi.fn(async () => []),
	peekDateGroups: vi.fn(() => null),
	setDateGroups: vi.fn(),
	toDateGroups: vi.fn(() => []),
	clearRenderedGroups: vi.fn(),
}
const mockFollowStore = {
	followedArtists: [] as unknown[],
	followedCount: 0,
	getFollowedArtistMap: vi.fn(async () => new Map()),
}
const mockJourneyStore = {
	journeyMap: new Map(),
	load: vi.fn(async () => new Map()),
	statusFor: vi.fn(() => undefined),
}
const mockResumeRevalidator = { register: vi.fn(), unregister: vi.fn() }
const mockOnboarding = {
	isOnboarding: false,
	isCompleted: false,
	finish: vi.fn(),
}
const mockUserStore = {
	current: { home: 'JP-13' },
	guestHome: null,
	setGuestHome: vi.fn(),
}
const mockI18n = { tr: vi.fn((key: string) => key) }
const mockStorage = {
	getItem: vi.fn((_key: string): string | null => null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
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
				IResumeRevalidator: mockResumeRevalidator,
				IOnboardingService: mockOnboarding,
				IUserStore: mockUserStore,
				I18N: mockI18n,
				ILocalStorage: mockStorage,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

vi.mock('@aurelia/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/i18n')>()
	return { ...actual, I18N: { friendlyName: 'I18N' } }
})

vi.mock('@aurelia/router', () => ({ RouteNode: class {} }))
vi.mock('@aurelia/runtime', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/runtime')>()
	return { ...actual, queueTask: vi.fn((fn: () => void) => fn()) }
})
vi.mock('@aurelia/runtime-html', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@aurelia/runtime-html')>()
	return { ...actual, watch: () => () => {} }
})

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
		mockOnboarding.isOnboarding = false
		mockAuth.isAuthenticated = false
		mockFollowStore.followedArtists = []
		mockFollowStore.followedCount = 0
		mockStorage.getItem.mockReturnValue(null)
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
		it('paints from cache without setting isLoading when lastDateGroups is available', async () => {
			const cached = [
				{
					dateKey: '2026-04-01',
					label: '4/1',
					isFirstOfMonth: false,
					monthSeparatorLabel: '',
					home: [],
					nearby: [],
					away: [],
				},
			]
			mockConcertService.peekDateGroups.mockReturnValue(cached)
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.isLoading).toBe(false)
			// Data rendered from cache immediately.
			expect(sut.dateGroups).toEqual(cached)
			// The spinner is never raised — that's the invariant. The background
			// refresh issues listByFollower (fire-and-forget), but isLoading stays false.
			expect(sut.isLoading).toBe(false)
		})

		it('falls through to cold load when no cache exists (first visit)', () => {
			mockConcertService.peekDateGroups.mockReturnValue(null)
			sut.needsRegion = false

			mockConcertService.listByFollower.mockReturnValueOnce(
				new Promise(() => {}),
			)
			void sut.loadData()

			expect(sut.isLoading).toBe(true)
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

			// The dashboard reflects the sheet's write in place; no listByFollower call.
			expect(sut.dateGroups[0].home[0].journeyStatus).toBe('applied')
			expect(sut.dateGroups[1].home[0].journeyStatus).toBeUndefined()
			expect(mockConcertService.listByFollower).not.toHaveBeenCalled()
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
		function makeRouteNode(fromParam: string | null) {
			return {
				queryParams: {
					get: (key: string) => (key === 'from' ? fromParam : null),
				},
			} as never
		}

		it('restores fromDate from a valid ?from param', async () => {
			await sut.loading({}, makeRouteNode('2020-01-01'))

			expect(sut.fromDate).toEqual({ year: 2020, month: 1, day: 1 })
		})

		it('falls back to today when the ?from value is malformed', async () => {
			await sut.loading({}, makeRouteNode('not-a-date'))

			// Malformed → default today-onward, so no from param round-trips out.
			expect(
				(sut as unknown as { isDefaultFrom(): boolean }).isDefaultFrom(),
			).toBe(true)
		})

		it('re-fetches ListByFollower with the new from on a date change', () => {
			mockConcertService.listByFollower.mockClear()
			const past = { year: 2020, month: 1, day: 1 }

			;(
				sut as unknown as {
					onDateFilterChanged(e: CustomEvent<typeof past>): void
				}
			).onDateFilterChanged(new CustomEvent('date-changed', { detail: past }))

			expect(sut.fromDate).toEqual(past)
			expect(mockConcertService.clearRenderedGroups).toHaveBeenCalledTimes(1)
			expect(mockConcertService.listByFollower).toHaveBeenCalledWith(
				past,
				expect.anything(),
			)
		})

		it('ignores a date change that matches the active from (no re-fetch)', () => {
			const same = sut.fromDate
			mockConcertService.listByFollower.mockClear()

			;(
				sut as unknown as {
					onDateFilterChanged(e: CustomEvent<typeof same>): void
				}
			).onDateFilterChanged(new CustomEvent('date-changed', { detail: same }))

			expect(mockConcertService.clearRenderedGroups).not.toHaveBeenCalled()
			expect(mockConcertService.listByFollower).not.toHaveBeenCalled()
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

		it('opens the sheet and derives the artist filter when the concert resolves', () => {
			sut.dateGroups = [makeGroup('artist-1'), makeGroup('artist-2')]
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-2')

			resolvePendingDeepLink(sut)

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

		it('self-clears so a later resolve pass never re-opens the sheet', () => {
			sut.dateGroups = [makeGroup('artist-1')]
			const sheet = stubDetailSheet(sut)
			setPendingConcertId(sut, 'h-artist-1')

			resolvePendingDeepLink(sut)
			resolvePendingDeepLink(sut)

			expect(sheet.open).toHaveBeenCalledTimes(1)
			expect(getPendingConcertId(sut)).toBeNull()
		})

		it('resolves against the authoritative cold-load fetch', async () => {
			mockAuth.isAuthenticated = true
			mockUserStore.current = { home: 'JP-13' }
			sut = new DashboardRoute()
			sut.needsRegion = false

			mockConcertService.peekDateGroups.mockReturnValueOnce(null)
			mockConcertService.listByFollower.mockResolvedValueOnce([{}] as never)
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
			mockConcertService.listByFollower.mockResolvedValueOnce([{}] as never)
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
		it('shows the guest light celebration (no confetti) on first dashboard arrival', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(false)
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

		it('does not show the light celebration for a completed guest (not onboarding)', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = false
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		it('does not replay the guest light celebration once shown', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'onboarding.celebrationShown' ? '1' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		it('defers the celebration while a region is still needed', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()
			sut.needsRegion = true

			// Even though data arrives, the gated handler must not celebrate over a
			// region-less (blurred) timetable.
			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		it('celebrates after the region is selected', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()
			sut.needsRegion = true
			sut.attached()
			expect(sut.showCelebration).toBe(false)

			await sut.onHomeSelected('JP-13')

			expect(mockUserStore.setGuestHome).toHaveBeenCalledWith('JP-13')
			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(false)
		})

		it('shows the post-signup full celebration (confetti) then the dialog', async () => {
			mockAuth.isAuthenticated = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'liverty:postSignup:shown' ? 'pending' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(true)
			expect(mockStorage.removeItem).toHaveBeenCalledWith(
				'liverty:postSignup:shown',
			)
			expect(sut.showPostSignupDialog).toBe(false)

			sut.onCelebrationDismissed()

			expect(sut.showCelebration).toBe(false)
			expect(sut.showPostSignupDialog).toBe(true)
		})

		it('does not celebrate for an authenticated returning user', async () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(sut.showCelebration).toBe(false)
		})

		it('does not celebrate over a still-loading timetable (data not yet arrived)', () => {
			mockAuth.isAuthenticated = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'liverty:postSignup:shown' ? 'pending' : null,
			)
			// Fetch never resolves → timetableLoaded never flips.
			mockConcertService.listByFollower.mockReturnValueOnce(
				new Promise(() => {}),
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			void sut.loadData()
			sut.attached()

			expect(sut.isLoading).toBe(true)
			expect(sut.showCelebration).toBe(false)
		})
	})

	describe('completion latch (finish via observed data arrival / onHomeSelected)', () => {
		it('latches finish() on a meaningful first arrival (region set, data loaded, followedCount >= 1)', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 1
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).toHaveBeenCalledTimes(1)
		})

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

		it('does NOT latch on a zero-follow arrival', async () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 0
			sut = new DashboardRoute()
			sut.needsRegion = false

			await sut.loadData()

			expect(mockOnboarding.finish).not.toHaveBeenCalled()
		})

		it('does NOT latch while the load is still in flight (data not yet arrived)', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockFollowStore.followedCount = 2
			mockConcertService.listByFollower.mockReturnValueOnce(
				new Promise(() => {}),
			)
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
})
