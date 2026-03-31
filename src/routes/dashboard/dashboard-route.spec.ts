import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DateGroup } from '../../entities/concert'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockHistory = { replaceState: vi.fn() }
const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: false }
const mockConcertService = {
	listByFollower: vi.fn(async () => []),
	toDateGroups: vi.fn(() => []),
}
const mockFollowService = {
	followedArtists: [],
	getFollowedArtistMap: vi.fn(async () => new Map()),
}
const mockJourneyService = { listByUser: vi.fn(async () => new Map()) }
const mockOnboarding = {
	isOnboarding: false,
	isCompleted: false,
	currentStep: 'done',
	setStep: vi.fn(),
}
const mockGuest = { home: null, setHome: vi.fn() }
const mockUserService = { current: { home: 'JP-13' } }
const mockNavDimming = { setDimmed: vi.fn() }
const mockStorage = {
	getItem: vi.fn(() => null),
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
				IConcertService: mockConcertService,
				IFollowServiceClient: mockFollowService,
				ITicketJourneyService: mockJourneyService,
				IOnboardingService: mockOnboarding,
				IGuestService: mockGuest,
				IUserService: mockUserService,
				INavDimmingService: mockNavDimming,
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
	return { ...actual, I18N: 'I18N' }
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

function makeGroup(artistId: string): DateGroup {
	return {
		label: '4月1日(火)',
		dateKey: '2026-04-01',
		home: [{ artistId, id: `h-${artistId}` } as never],
		nearby: [],
		away: [],
	}
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardRoute', () => {
	let sut: DashboardRoute

	beforeEach(() => {
		vi.clearAllMocks()
		mockOnboarding.isOnboarding = false
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

	describe('updateFilterUrl (via filteredArtistIdsChanged)', () => {
		it('replaces URL to /dashboard when filter is cleared', () => {
			sut.filteredArtistIds = []
			sut.filteredArtistIdsChanged()

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard',
			)
		})

		it('replaces URL with artists param when filter is set', () => {
			sut.filteredArtistIds = ['id-1', 'id-2']
			sut.filteredArtistIdsChanged()

			expect(mockHistory.replaceState).toHaveBeenCalledWith(
				null,
				'',
				'/dashboard?artists=id-1,id-2',
			)
		})
	})

	describe('loading() — query param parsing', () => {
		function makeRouteNode(artistsParam: string | null) {
			return {
				queryParams: {
					get: (key: string) => (key === 'artists' ? artistsParam : null),
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
	})
})
