import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockRouter } from '../helpers/mock-router'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIConcertStore = DI.createInterface('IConcertStore')
const mockIPurchasedTicketStore = DI.createInterface('IPurchasedTicketStore')
const mockIUserStore = DI.createInterface('IUserStore')
const mockIFollowStore = DI.createInterface('IFollowStore')
const mockITicketJourneyStore = DI.createInterface('ITicketJourneyStore')

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
vi.mock('../../src/services/follow-store', () => ({
	IFollowStore: mockIFollowStore,
}))
vi.mock('../../src/services/ticket-journey-store', () => ({
	ITicketJourneyStore: mockITicketJourneyStore,
}))

const { NearbyConcerts, NearbyVisit } = await import(
	'../../src/components/all-nearby/nearby-concerts'
)
const { IUserHydration } = await import(
	'../../src/services/user-hydration-task'
)
const { resolvePreset } = await import(
	'../../src/components/all-nearby/date-presets'
)
const { loadNearbyFilter } = await import(
	'../../src/adapter/storage/nearby-filter-storage'
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

function rangeEvent(
	range: Range,
	label: string,
	applied?: 'weekend' | 'week' | 'month' | null,
) {
	return new CustomEvent('range-changed', {
		detail: { ...range, label, ...(applied !== undefined && { applied }) },
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
	let mockFollow: { hypeByArtist: Map<string, string> }
	let mockHydration: { ready: Promise<void> }
	let mockJourney: {
		journeyMap: Map<string, string>
		load: ReturnType<typeof vi.fn>
	}

	function build(visit = new NearbyVisit()) {
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIConcertStore, mockConcert),
			Registration.instance(mockIPurchasedTicketStore, mockPurchased),
			Registration.instance(mockIUserStore, mockUserStore),
			Registration.instance(IRouter, mockRouter),
			Registration.instance(mockIFollowStore, mockFollow),
			Registration.instance(mockITicketJourneyStore, mockJourney),
			Registration.instance(IUserHydration, mockHydration),
		)
		container.register(NearbyConcerts)
		const sut = container.get(NearbyConcerts)
		sut.visit = visit
		sut.areaSelector = { open: vi.fn() } as never
		sut.dateSheet = { open: vi.fn() } as never
		sut.detailSheet = { open: vi.fn() } as never
		sut.filterSheet = { open: vi.fn() } as never
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
		mockFollow = { hypeByArtist: new Map([['a1', 'home']]) }
		mockHydration = { ready: Promise.resolve() }
		mockJourney = {
			journeyMap: new Map(),
			load: vi.fn().mockResolvedValue(new Map()),
		}
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
				mockFollow.hypeByArtist,
				mockJourney.journeyMap,
				mockPurchased.countByEvent,
			)
			// The server's groups are kept, so the cards can be re-derived.
			expect([...visit.cache.values()]).toEqual([[{ key: 'proximity' }]])
			first.detaching()

			// Switching to the artist bubbles and back re-creates the view; the
			// visit (owned by the route) still holds the area, range and result.
			const again = build(visit)
			again.onRangeChanged(rangeEvent(visit.range as Range, '7日以内'))
			await again.load()
			expect(again.dateGroups).toEqual(first.dateGroups)
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
			await vi.waitFor(() => expect(signals).toHaveLength(1))
			sut.onAreaSelected('JP-43')
			await vi.waitFor(() => expect(signals).toHaveLength(2))
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
		// @spec components/infrastructure/fan/web/global/user-home-selector "Caller owns persistence — All Nearby area override"
		it('opens the area selector from the area row and keeps the choice as the override', async () => {
			const sut = build()
			sut.onFilterRowChosen(
				new CustomEvent('filter-row-chosen', { detail: 'area' }) as never,
			)
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
		})

		// @spec components/infrastructure/fan/web/route/discovery "Area override is kept on the device"
		it('starts the next visit on the kept override, without touching the home area', () => {
			mockUserStore.currentHome = 'JP-13'
			build().onAreaSelected('JP-27')

			// Leaving Discovery or reloading creates a new route, with a new visit.
			const next = build(new NearbyVisit())
			expect(next.effectiveAreaCode).toBe('JP-27')
			expect(next.selectedAreaName).toBe('大阪府')
			expect(mockUserStore.currentHome).toBe('JP-13')
			expect(mockUserStore.updateHome).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Choosing the home area clears the override"
		it('follows the home area again once the fan chooses it', () => {
			mockUserStore.currentHome = 'JP-13'
			const sut = build()
			sut.onAreaSelected('JP-27')
			sut.onAreaSelected('JP-13')

			expect(sut.visit.areaCode).toBeNull()
			expect(loadNearbyFilter().areaCode).toBeNull()
			// The fan later moves to 神奈川県.
			mockUserStore.currentHome = 'JP-14'
			expect(build(new NearbyVisit()).effectiveAreaCode).toBe('JP-14')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Area override for unauthenticated user"
		it('asks a guest without a home area to choose one before listing anything', async () => {
			mockAuth.isAuthenticated = false
			mockUserStore.currentHome = null
			const sut = build()

			expect(sut.selectedAreaName).toBe('')
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() =>
				expect(sut.areaSelector?.open).toHaveBeenCalledOnce(),
			)
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
			// Kept on the device as the override, not as the guest home.
			expect(loadNearbyFilter().areaCode).toBe('JP-40')
		})
	})

	describe("before the fan's account has arrived", () => {
		/** A boot-time hydration the test settles itself. */
		function pendingHydration(): () => void {
			let settle = () => {}
			mockHydration.ready = new Promise((resolve) => {
				settle = resolve
			})
			return settle
		}

		it('waits for the account and lists around its home area', async () => {
			const settle = pendingHydration()
			mockUserStore.currentHome = null
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await Promise.resolve()

			// No area is asked of a fan who has one.
			expect(sut.areaSelector?.open).not.toHaveBeenCalled()
			expect(mockConcert.listByLocation).not.toHaveBeenCalled()

			mockUserStore.currentHome = 'JP-13'
			settle()
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledWith(
					expect.objectContaining({ adminArea: 'JP-13' }),
					WEEK.from,
					WEEK.to,
					expect.any(AbortSignal),
				),
			)
			expect(sut.areaSelector?.open).not.toHaveBeenCalled()
		})

		it('shows the loading state, not the empty one, while it waits', async () => {
			pendingHydration()
			mockUserStore.currentHome = null
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			expect(sut.isLoading).toBe(true)
		})

		it('does nothing more once the view has gone while it waited', async () => {
			const settle = pendingHydration()
			mockUserStore.currentHome = null
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			sut.detaching()
			settle()
			await new Promise((r) => setTimeout(r, 0))
			expect(sut.areaSelector?.open).not.toHaveBeenCalled()
			expect(mockConcert.listByLocation).not.toHaveBeenCalled()
		})

		it('does not wait when the area is already known on the device', async () => {
			pendingHydration()
			mockUserStore.currentHome = null
			const sut = build(
				new NearbyVisit({ areaCode: 'JP-27', datePreset: null }),
			)
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() =>
				expect(mockConcert.listByLocation).toHaveBeenCalledWith(
					expect.objectContaining({ adminArea: 'JP-27' }),
					WEEK.from,
					WEEK.to,
					expect.any(AbortSignal),
				),
			)
		})

		it('asks a fan whose account has no home area for one', async () => {
			const settle = pendingHydration()
			mockUserStore.currentHome = null
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			settle()
			await vi.waitFor(() =>
				expect(sut.areaSelector?.open).toHaveBeenCalledOnce(),
			)
			expect(mockConcert.listByLocation).not.toHaveBeenCalled()
		})
	})

	describe('kept period', () => {
		const SPEC = 'components/infrastructure/fan/web/route/discovery'

		it(`@spec ${SPEC} "A preset is kept for the next visit"`, () => {
			build().onRangeChanged(rangeEvent(WEEKEND, '今週末', 'weekend'))

			// A new visit computes the preset from the new day's date.
			const next = new NearbyVisit()
			expect(next.datePreset).toBe('weekend')
			expect(next.range).toEqual(resolvePreset('weekend'))
		})

		it(`@spec ${SPEC} "A custom range is not kept"`, () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEKEND, '今週末', 'weekend'))
			sut.onRangeChanged(rangeEvent(WEEK, '8/12〜8/20', null))

			expect(sut.visit.datePreset).toBeNull()
			const next = new NearbyVisit()
			expect(next.datePreset).toBe('week')
			expect(next.range).toEqual(resolvePreset('week'))
		})

		it(`@spec ${SPEC} "The device keeps nothing"`, () => {
			vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
				throw new DOMException('denied', 'SecurityError')
			})
			const next = new NearbyVisit()
			expect(next.datePreset).toBe('week')
			expect(next.areaCode).toBeNull()
		})

		it('keeps nothing new for the range the sheet emits on bind', () => {
			build().onRangeChanged(rangeEvent(WEEK, '7日以内'))
			expect(localStorage.getItem('discovery.nearbyFilter')).toBeNull()
		})
	})

	describe('filter sheet', () => {
		// @spec components/infrastructure/fan/web/route/discovery "Timetable height is unaffected by filter interaction"
		it('puts no filter control above the timetable; every filter surface is a sheet', () => {
			const doc = parsedTemplate()
			expect(doc.querySelector('.nearby-filters')).toBeNull()
			expect(doc.querySelector('[data-testid="nearby-area-chip"]')).toBeNull()
			// The timetable is the first element the view lays out.
			const laidOut = [...doc.body.children].filter(
				(el) => el.tagName !== 'IMPORT',
			)
			expect(laidOut[0].tagName).toBe('CONCERT-HIGHWAY')
			// The filter surfaces are bottom sheets, outside the layout flow.
			expect(doc.querySelector('nearby-filter-sheet')).not.toBeNull()
			expect(doc.querySelector('user-home-selector')).not.toBeNull()
			expect(doc.querySelector('date-range-sheet')).not.toBeNull()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Filter item opens the filter sheet"
		it('opens the filter sheet for the launcher, with the area and the period', () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			sut.openFilters()
			expect(sut.filterSheet?.open).toHaveBeenCalledOnce()
			expect(sut.selectedAreaName).toBe('福岡県')
			expect(sut.periodLabel).toBe('7日以内')
			const sheet = parsedTemplate().querySelector('nearby-filter-sheet')
			expect(sheet?.getAttribute('area-name.bind')).toBe('selectedAreaName')
			expect(sheet?.getAttribute('period-label.bind')).toBe('periodLabel')
		})

		// @spec components/infrastructure/fan/web/route/discovery "Period row opens the range sheet in one tap"
		it('opens the date-range sheet for the period row', () => {
			const sut = build()
			sut.onFilterRowChosen(
				new CustomEvent('filter-row-chosen', { detail: 'period' }) as never,
			)
			expect(sut.dateSheet?.open).toHaveBeenCalledOnce()
			expect(sut.areaSelector?.open).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/fan/web/route/discovery "Preset shows its name"
		// @spec components/infrastructure/fan/web/route/discovery "Period row shows a localized range"
		it('shows the label the date-range sheet supplies on the period row', () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEKEND, '今週末'))
			expect(sut.periodLabel).toBe('今週末')
			sut.onRangeChanged(rangeEvent(WEEK, '8/12〜8/20'))
			expect(sut.periodLabel).toBe('8/12〜8/20')
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
		it('says nothing was found and suggests another period or area', async () => {
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
			// No link away from the view: the launcher's filter is the way forward.
			expect(empty?.querySelector('a')).toBeNull()
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

	describe('matched state and journeys', () => {
		const SPEC = 'components/infrastructure/fan/web/route/discovery'

		it(`@spec ${SPEC} "Journey badge shown"`, async () => {
			mockJourney.journeyMap = new Map([['ev-1', 'tracking']])
			const sut = build()
			// A visit straight to /discovery?view=nearby loads the journeys.
			sut.attached()
			expect(mockJourney.load).toHaveBeenCalledOnce()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() => expect(sut.dateGroups).toHaveLength(1))
			expect(mockConcert.toDateGroupsForLocation).toHaveBeenLastCalledWith(
				[{ key: 'proximity' }],
				mockFollow.hypeByArtist,
				mockJourney.journeyMap,
				mockPurchased.countByEvent,
			)
		})

		it(`@spec ${SPEC} "Journey or hype changed in the detail sheet"`, async () => {
			const sut = build()
			sut.onRangeChanged(rangeEvent(WEEK, '7日以内'))
			await vi.waitFor(() => expect(sut.dateGroups).toHaveLength(1))
			mockConcert.toDateGroupsForLocation.mockReturnValue([
				{ dateKey: 'rederived' },
			])

			// The fan sets a journey in the detail sheet …
			mockJourney.journeyMap = new Map([['ev-1', 'tracking']])
			// @ts-expect-error -- the @watch callback, as Aurelia calls it
			sut.onFanStateChanged()
			expect(sut.dateGroups).toEqual([{ dateKey: 'rederived' }])
			expect(mockConcert.toDateGroupsForLocation).toHaveBeenLastCalledWith(
				[{ key: 'proximity' }],
				mockFollow.hypeByArtist,
				mockJourney.journeyMap,
				mockPurchased.countByEvent,
			)

			// … or changes a followed artist's level elsewhere.
			mockFollow.hypeByArtist = new Map([['a1', 'away']])
			// @ts-expect-error -- the @watch callback, as Aurelia calls it
			sut.onFanStateChanged()
			expect(mockConcert.toDateGroupsForLocation).toHaveBeenLastCalledWith(
				[{ key: 'proximity' }],
				mockFollow.hypeByArtist,
				mockJourney.journeyMap,
				mockPurchased.countByEvent,
			)
			// Re-derived without a request.
			expect(mockConcert.listByLocation).toHaveBeenCalledTimes(1)
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
