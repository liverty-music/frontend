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
const mockFollowStore = {
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
				ITicketJourneyService: mockJourneyService,
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
		mockOnboarding.currentStep = 'done'
		mockAuth.isAuthenticated = false
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

	describe('maybeCelebrate (via attached / onHomeSelected)', () => {
		it('shows the guest light celebration (no confetti) on first dashboard arrival', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()
			sut.needsRegion = false

			sut.attached()

			expect(sut.showCelebration).toBe(true)
			expect(sut.celebrationConfetti).toBe(false)
			expect(mockStorage.setItem).toHaveBeenCalledWith(
				'onboarding.celebrationShown',
				'1',
			)
		})

		it('does not show the light celebration for a completed guest (not onboarding)', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = false
			sut = new DashboardRoute()
			sut.needsRegion = false

			sut.attached()

			expect(sut.showCelebration).toBe(false)
		})

		it('does not replay the guest light celebration once shown', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'onboarding.celebrationShown' ? '1' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			sut.attached()

			expect(sut.showCelebration).toBe(false)
		})

		it('defers the celebration while a region is still needed', () => {
			mockAuth.isAuthenticated = false
			mockOnboarding.isOnboarding = true
			sut = new DashboardRoute()
			sut.needsRegion = true

			sut.attached()

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

		it('shows the post-signup full celebration (confetti) then the dialog', () => {
			mockAuth.isAuthenticated = true
			mockStorage.getItem.mockImplementation((k: string) =>
				k === 'liverty:postSignup:shown' ? 'pending' : null,
			)
			sut = new DashboardRoute()
			sut.needsRegion = false

			sut.attached()

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

		it('does not celebrate for an authenticated returning user', () => {
			mockAuth.isAuthenticated = true
			sut = new DashboardRoute()
			sut.needsRegion = false

			sut.attached()

			expect(sut.showCelebration).toBe(false)
		})
	})
})
