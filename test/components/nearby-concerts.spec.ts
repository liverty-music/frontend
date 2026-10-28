import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIPurchasedTicketStore = DI.createInterface('IPurchasedTicketStore')
const mockIUserStore = DI.createInterface('IUserStore')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/concert-store', () => ({
	IConcertStore: mockIConcertStore,
}))
vi.mock('../../src/services/purchased-ticket-store', () => ({
	IPurchasedTicketStore: mockIPurchasedTicketStore,
}))
vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
}))

const { NearbyConcerts, NearbyVisit } = await import(
	'../../src/components/all-nearby/nearby-concerts'
)
const { default: template } = await import(
	'../../src/components/all-nearby/nearby-concerts.html?raw'
)

type Range = { from: object; to: object }
const WEEK = {
	from: { year: 2026, month: 10, day: 27 },
	to: { year: 2026, month: 11, day: 2 },
}
const WEEKEND = {
	from: { year: 2026, month: 10, day: 31 },
	to: { year: 2026, month: 11, day: 1 },
}

function rangeEvent(range: Range, label: string) {
	return new CustomEvent('range-changed', {
		detail: { ...range, label },
	}) as unknown as Parameters<
		InstanceType<typeof NearbyConcerts>['onRangeChanged']
	>[0]
}

function selected(isFirstParty: boolean) {
	return new CustomEvent('event-selected', {
		detail: { event: { id: 'ev-1', artistId: 'a1', isFirstParty } },
	}) as unknown as Parameters<
		InstanceType<typeof NearbyConcerts>['onEventSelected']
	>[0]
}

function parsedTemplate(): Document {
	return new DOMParser().parseFromString(
		`<body>${template}</body>`,
		'text/html',
	)
}

describe('NearbyConcerts', () => {
	let mockAuth: { isAuthenticated: boolean; signUp: ReturnType<typeof vi.fn> }
	let mockConcert: {
		listByLocation: ReturnType<typeof vi.fn>
		toDateGroupsForLocation: ReturnType<typeof vi.fn>
	}
	let mockPurchased: { countByEvent: Map<string, number> }
	let mockUserStore: {
		currentHome: string | null
		currentLanguage: string
		updateHome: ReturnType<typeof vi.fn>
		setGuestHome: ReturnType<typeof vi.fn>
	}
	let mockRouter: ReturnType<typeof createMockRouter>

	function build(visit = new NearbyVisit()) {
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(mockIPurchasedTicketStore, mockPurchased),
			Registration.instance(mockIUserStore, mockUserStore),
			Registration.instance(IRouter, mockRouter),
		)
		container.register(NearbyConcerts)
		const sut = container.get(NearbyConcerts)
		sut.visit = visit
		sut.areaSelector = { open: vi.fn() } as never
		sut.dateSheet = { open: vi.fn() } as never
		sut.detailSheet = { open: vi.fn() } as never
		return sut
	}

	beforeEach(() => {
		mockAuth = { isAuthenticated: true, signUp: vi.fn() }
		mockConcert = {
			listByLocation: vi.fn().mockResolvedValue([{ key: 'proximity' }]),
			toDateGroupsForLocation: vi.fn(() => [{ dateKey: '2026-10-31' }]),
		}
		mockPurchased = { countByEvent: new Map() }
		mockUserStore = {
			currentHome: 'JP-40',
			currentLanguage: 'ja',
			updateHome: vi.fn(),
			setGuestHome: vi.fn(),
		}
		mockRouter = createMockRouter()
		localStorage.clear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('ListByLocation and the visit cache', () => {
		// @spec components/infrastructure/fan/web/route/discovery "All Nearby result cached independently"
		it('keeps the result for the visit and reuses it when the fan comes back to the view', async () => {
			const visit = new NearbyVisit()
			const first = build(visit)
			first.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() => expect(first.dateGroups).toHaveLength(1))
			expect(mockConcert.listByLocation).toHaveBeenCalledTimes(1)
			expect(mockConcert.toDateGroupsForLocation).toHaveBeenCalledWith(
				[{ key: 'proximity' }],
				mockPurchased.countByEvent,
			)
			first.detaching()

			// Switching to the artist bubbles and back re-creates the view; the
			// visit (owned by the route) still holds the area, range and result.
			const again = build(visit)
			again.onRangeChanged(rangeEvent(visit.range as Range, '7日以内'))
			await again.load()
			expect(again.dateGroups).toBe(first.dateGroups)
			expect(mockConcert.listByLocation).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Cache invalidated on filter change"
		it('fetches again with the new parameters when the area or the period changes', async () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledTimes(1),
			)

			sut.onAreaSelected('JP-43')
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledTimes(2),
			)
			expect(mockConcert.listByLocation).toHaveBeenLastCalledWith(
				expect.objectContaining({ adminArea: 'JP-43' }),
				WEEK.from,
				WEEK.to,
				expect.any(AbortSignal),
			)

			sut.onRangeChanged(rangeEvent(WEEKEND, '今週末'))
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledTimes(3),
			)
			expect(mockConcert.listByLocation).toHaveBeenLastCalledWith(
				expect.objectContaining({ adminArea: 'JP-43' }),
				WEEKEND.from,
				WEEKEND.to,
				expect.any(AbortSignal),
			)
		})

		it('aborts the request in flight when the filter changes', async () => {
			const signals: AbortSignal[] = []
			mockConcert.listByLocation.mockImplementation(
				(_g: unknown, _f: unknown, _t: unknown, signal: AbortSignal) => {
					signals.push(signal)
					return new Promise(() => {})
				},
			)
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			sut.onAreaSelected('JP-43')
			expect(signals[0].aborted).toBe(true)
			expect(signals[1].aborted).toBe(false)
			sut.detaching()
			expect(signals[1].aborted).toBe(true)
		})

		it('shows a retryable error when the request fails', async () => {
			mockConcert.listByLocation.mockRejectedValue(new Error('down'))
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() => expect(sut.loadError).not.toBeNull())
			expect(sut.isLoading).toBe(false)
			expect(sut.dateGroups).toEqual([])
		})
	})

	describe('area chip', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Default area is user home"
		it("shows the fan's home area and asks ListByLocation about it", async () => {
			const sut = build()
			expect(sut.selectedAreaName).toBe('福岡県')

			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalled(),
			)
			const [geo] = mockConcert.listByLocation.mock.calls[0]
			expect(geo).toEqual(
				expect.objectContaining({
					adminArea: 'JP-40',
					latitude: expect.any(Number),
					longitude: expect.any(Number),
				}),
			)
		})

		// @spec components/infrastructure/fan/web/route/discovery "Area override via UserHomeSelector"
		// @spec components/infrastructure/fan/web/global/user-home-selector "Caller owns persistence — session-only override"
		it('opens the area selector from the chip and keeps the choice in the visit only', async () => {
			const sut = build()
			sut.openAreaSelector()
			expect(sut.areaSelector?.open).toHaveBeenCalledOnce()

			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			sut.onAreaSelected('JP-27')

			expect(sut.visit.areaCode).toBe('JP-27')
			expect(sut.selectedAreaName).toBe('大阪府')
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenLastCalledWith(
					expect.objectContaining({ adminArea: 'JP-27' }),
					WEEK.from,
					WEEK.to,
					expect.any(AbortSignal),
				),
			)
			expect(mockUserStore.updateHome).not.toHaveBeenCalled()
			expect(mockUserStore.setGuestHome).not.toHaveBeenCalled()
			expect(localStorage.getItem('guest.home')).toBeNull()

			// The chip opens the shared selector.
			const chip = parsedTemplate().querySelector(
				'[data-testid="nearby-area-chip"]',
			)
			expect(chip?.getAttribute('click.trigger')).toBe('openAreaSelector()')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Area override is session-scoped"
		it("starts a new visit on the fan's home area again", () => {
			const visit = new NearbyVisit()
			build(visit).onAreaSelected('JP-27')
			// Leaving Discovery or reloading creates a new route, with a new visit.
			const next = build(new NearbyVisit())
			expect(next.effectiveAreaCode).toBe('JP-40')
			expect(next.selectedAreaName).toBe('福岡県')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Area override for unauthenticated user"
		it('asks a guest without a home area to choose one before listing anything', async () => {
			mockAuth.isAuthenticated = false
			mockUserStore.currentHome = null
			const sut = build()

			expect(sut.selectedAreaName).toBe('')
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			expect(sut.areaSelector?.open).toHaveBeenCalledOnce()
			expect(mockConcert.listByLocation).not.toHaveBeenCalled()

			sut.onAreaSelected('JP-40')
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledWith(
					expect.objectContaining({ adminArea: 'JP-40' }),
					WEEK.from,
					WEEK.to,
					expect.any(AbortSignal),
				),
			)
			expect(mockUserStore.setGuestHome).not.toHaveBeenCalled()
			expect(localStorage.getItem('guest.home')).toBeNull()
		})
	})

	describe('filter bar', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Filter bar is a single row of two chips"
		// @spec components/infrastructure/fan/web/route/discovery "Timetable height is unaffected by filter interaction"
		it('is one row of two chips that each open a bottom sheet, never an inline panel', () => {
			const doc = parsedTemplate()
			const bar = doc.querySelector('.nearby-filters')
			const chips = bar?.querySelectorAll(':scope > button.filter-chip')
			expect(chips).toHaveLength(2)
			expect(bar?.children).toHaveLength(2)
			expect(
				[...(chips ?? [])].map((c) => c.getAttribute('click.trigger')),
			).toEqual(['openAreaSelector()', 'openDateSheet()'])
			// Both opened surfaces are bottom sheets outside the layout flow.
			expect(doc.querySelector('user-home-selector')).not.toBeNull()
			expect(doc.querySelector('date-range-sheet')).not.toBeNull()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Date chip opens the range sheet in one tap"
		it('opens the date-range sheet from the date chip', () => {
			const sut = build()
			sut.openDateSheet()
			expect(sut.dateSheet?.open).toHaveBeenCalledOnce()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Preset shows its name"
		// @spec components/infrastructure/fan/web/route/discovery "Date chip shows a localized range"
		it('shows the label the date-range sheet supplies', () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEKEND, '今週末'))
			expect(sut.dateChipLabel).toBe('今週末')
			sut.onRangeChanged(rangeEvent(WEEK, '8/12〜8/20'))
			expect(sut.dateChipLabel).toBe('8/12〜8/20')
		})
	})

	describe('concert list', () => {
		// @spec components/infrastructure/fan/web/route/discovery "HOME and NEARBY lanes rendered"
		// @spec components/infrastructure/fan/web/route/discovery "Venue name shown for all lanes"
		it('renders the location groups in the two-lane timetable with the venue on every card', async () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() => expect(sut.dateGroups).toHaveLength(1))

			const highway = parsedTemplate().querySelector('concert-highway')
			expect(highway?.getAttribute('date-groups.bind')).toBe('dateGroups')
			expect(highway?.getAttribute('hide-away.bind')).toBe('true')
			expect(highway?.getAttribute('show-venue-always.bind')).toBe('true')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Empty state"
		it('says nothing was found and suggests another period or area, with the chips still above', async () => {
			mockConcert.listByLocation.mockResolvedValue([])
			mockConcert.toDateGroupsForLocation.mockReturnValue([])
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalled(),
			)
			await vi.waitFor(() => expect(sut.isLoading).toBe(false))
			expect(sut.dateGroups).toEqual([])

			const doc = parsedTemplate()
			const empty = doc.querySelector('[data-testid="all-nearby-empty"]')
			expect(empty?.getAttribute('if.bind')).toBe(
				'!isLoading && !loadError && dateGroups.length === 0',
			)
			expect(
				[...(empty?.querySelectorAll('[t]') ?? [])].map((n) =>
					n.getAttribute('t'),
				),
			).toEqual(['allNearby.empty.title', 'allNearby.empty.subtitle'])
			// No link away from the view: the chips are the way forward.
			expect(empty?.querySelector('a')).toBeNull()
			expect(
				doc.querySelector('.nearby-filters')?.hasAttribute('if.bind'),
			).toBe(false)
		})

		// @spec components/infrastructure/fan/web/route/discovery "First-party concert opens its event page"
		it('opens the Event page of a first-party concert instead of the sheet', () => {
			const sut = build()
			sut.onEventSelected(selected(true))
			expect(mockRouter.load).toHaveBeenCalledWith('/events/ev-1')
			expect(sut.detailSheet?.open).not.toHaveBeenCalled()
		})

		it('opens a discovered concert in the detail sheet with the follow action', () => {
			const sut = build()
			sut.onEventSelected(selected(false))
			expect(sut.detailSheet?.open).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'ev-1' }),
				'all_nearby',
				true,
			)
			expect(mockRouter.load).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Closing the detail sheet returns to the list"
		it('keeps the area, the range and the list while the sheet opens and closes', async () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEKEND, '今週末'))
			sut.onAreaSelected('JP-43')
			await vi.waitFor(() => expect(sut.dateGroups).toHaveLength(1))
			const groups = sut.dateGroups

			sut.onEventSelected(selected(false))

			// The sheet is an overlay: nothing in the view is reset or refetched.
			expect(sut.visit.areaCode).toBe('JP-43')
			expect(sut.visit.range).toEqual(WEEKEND)
			expect(sut.dateGroups).toBe(groups)
			expect(mockConcert.listByLocation).toHaveBeenCalledTimes(2)
		})
	})

	describe('follow from the detail sheet', () => {
		// @spec components/infrastructure/fan/web/global/bottom-sheet "Follow prompt for unauthenticated user"
		it('asks the host to offer sign-up when a guest taps follow', () => {
			mockAuth.isAuthenticated = false
			const sut = build()
			const offer = vi.fn()
			sut.onSignupRequested = offer
			sut.onFollowSignupRequested()
			expect(offer).toHaveBeenCalledOnce()
		})

		it('asks nothing for a signed-in fan', () => {
			const sut = build()
			const offer = vi.fn()
			sut.onSignupRequested = offer
			sut.onFollowSignupRequested()
			expect(offer).not.toHaveBeenCalled()
		})
	})
})
