import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import {
	PublishState,
	SeriesSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	concertResolver,
	IConcertRpcClient,
	type ResolvedConcert,
} from '../../src/adapter/rpc/client/concert-client'
import { ITicketSaleRpcClient } from '../../src/adapter/rpc/client/ticket-sale-client'
import type { Artist } from '../../src/entities/artist'
import {
	type EventTicketSales,
	NO_TICKET_SALES,
	type TicketSale,
	type TicketStock,
} from '../../src/entities/ticket-sale'
import {
	Events,
	IAnalyticsService,
} from '../../src/lib/analytics/analytics-service'
import { EventRoute } from '../../src/routes/event/event-route'
import { IAuthService } from '../../src/services/auth-service'
import { IFollowStore } from '../../src/services/follow-store'
import {
	type HeldTickets,
	IHeldSeatTypeService,
} from '../../src/services/held-seat-type-service'
import { IPurchasedTicketStore } from '../../src/services/purchased-ticket-store'
import { IUserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAnalytics } from '../helpers/mock-analytics'
import { createMockAuth } from '../helpers/mock-auth'

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'
const SERIES_ID = '019a0000-0000-7000-8000-0000000000a1'
const ARTIST_ID = '019a0000-0000-7000-8000-0000000000b1'

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute))
}

interface ConcertOpts {
	id?: string
	day?: number
	open?: Date
	start?: Date
	cover?: boolean
	/** The event's own publish state. */
	state?: PublishState
	/** The Series' derived publish state; defaults to PUBLISHED. */
	seriesState?: PublishState
	title?: string
}

/**
 * A Concert as ConcertService returns it — the Concert with its Series and
 * Artist in the side lists — resolved the way the RPC client resolves it.
 */
function protoConcert(o: ConcertOpts = {}): ResolvedConcert {
	const day = o.day ?? 20
	const concert = create(ConcertSchema, {
		event: {
			id: { value: o.id ?? EVENT_ID },
			localDate: { value: { year: 2026, month: 11, day } },
			openTime: o.open ? { value: timestampFromDate(o.open) } : undefined,
			startTime: o.start ? { value: timestampFromDate(o.start) } : undefined,
			listedVenueName: { value: 'Shibuya WWW' },
			venue: { name: { value: 'WWW' }, adminArea: { value: 'JP-13' } },
			seriesId: { value: SERIES_ID },
			publishState: o.state ?? PublishState.PUBLISHED,
		},
		artistIds: [{ value: ARTIST_ID }],
	})
	const series = create(SeriesSchema, {
		id: { value: SERIES_ID },
		title: { value: o.title ?? 'ONE MAN LIVE' },
		description: { value: '二夜連続公演' },
		organizerId: { value: 'org-1' },
		publishState: o.seriesState ?? PublishState.PUBLISHED,
		coverImage: o.cover
			? {
					id: { value: 'series-image-1' },
					thumb: { value: 'https://images.example/thumb.webp' },
					large: { value: 'https://images.example/large.webp' },
				}
			: undefined,
	})
	const artist = create(ArtistSchema, {
		id: { value: ARTIST_ID },
		name: { value: 'The Band' },
	})
	const resolved = concertResolver([series], [artist])(concert)
	if (!resolved) throw new Error('fixture concert has no event')
	return resolved
}

function makeFollowStore() {
	const store = {
		followedArtists: [] as Artist[],
		get followedIds(): ReadonlySet<string> {
			return new Set(store.followedArtists.map((a) => a.id))
		},
		follow: vi.fn(async (artist: Artist) => {
			store.followedArtists = [...store.followedArtists, artist]
		}),
		listFollowed: vi.fn(async () => []),
		unfollow: vi.fn(async (id: string) => {
			store.followedArtists = store.followedArtists.filter((a) => a.id !== id)
		}),
	}
	return store
}

function makePurchasedStore(counts = new Map<string, number>()) {
	return {
		countByEvent: counts,
		countFor: (id: string | undefined) => (id ? (counts.get(id) ?? 0) : 0),
		load: vi.fn().mockResolvedValue(counts),
	}
}

describe('EventRoute', () => {
	let concertClient: {
		get: ReturnType<typeof vi.fn>
		listBySeries: ReturnType<typeof vi.fn>
	}
	let auth: ReturnType<typeof createMockAuth>
	let follow: ReturnType<typeof makeFollowStore>
	let purchased: ReturnType<typeof makePurchasedStore>
	let userStore: { currentLanguage: string }
	let ticketSaleClient: { listByEvent: ReturnType<typeof vi.fn> }
	let heldSeatTypes: { heldTickets: ReturnType<typeof vi.fn> }
	let analytics: ReturnType<typeof createMockAnalytics>

	function build(): EventRoute {
		analytics = createMockAnalytics()
		const container = createTestContainer(
			Registration.instance(IConcertRpcClient, concertClient),
			Registration.instance(IAuthService, auth),
			Registration.instance(IFollowStore, follow),
			Registration.instance(IPurchasedTicketStore, purchased),
			Registration.instance(IUserStore, userStore),
			Registration.instance(ITicketSaleRpcClient, ticketSaleClient),
			Registration.instance(IHeldSeatTypeService, heldSeatTypes),
			Registration.instance(IAnalyticsService, analytics),
		)
		container.register(EventRoute)
		return container.get(EventRoute)
	}

	async function open(sut: EventRoute, id = EVENT_ID): Promise<void> {
		sut.loading({ id })
		await vi.waitFor(() => expect(sut.state).not.toBe('loading'))
		// Let the non-blocking dates and ticket reads settle.
		await new Promise((r) => setTimeout(r, 0))
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(jst(1, 12))
		concertClient = {
			get: vi.fn().mockResolvedValue(protoConcert()),
			listBySeries: vi.fn().mockResolvedValue([protoConcert()]),
		}
		auth = createMockAuth({ isAuthenticated: false })
		follow = makeFollowStore()
		purchased = makePurchasedStore()
		userStore = { currentLanguage: 'ja' }
		ticketSaleClient = {
			listByEvent: vi.fn().mockResolvedValue(NO_TICKET_SALES),
		}
		heldSeatTypes = { heldTickets: vi.fn().mockResolvedValue(null) }
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('loading', () => {
		it('shows the event to a guest without asking to sign in', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest opens a shared link"
			const sut = build()
			await open(sut)

			expect(concertClient.get).toHaveBeenCalledWith(
				EVENT_ID,
				expect.any(AbortSignal),
			)
			expect(concertClient.listBySeries).toHaveBeenCalledWith(
				SERIES_ID,
				expect.any(AbortSignal),
			)
			expect(sut.state).toBe('ready')
			expect(sut.event?.title).toBe('ONE MAN LIVE')
			expect(sut.event?.performers.map((p) => p.name)).toEqual(['The Band'])
			expect(sut.event?.venueName).toBe('Shibuya WWW')
			expect(sut.prefecture).toBe('東京都')
			expect(sut.mapsUrl).toContain(encodeURIComponent('Shibuya WWW 東京都'))
			expect(auth.signIn).not.toHaveBeenCalled()
			expect(auth.signUp).not.toHaveBeenCalled()
			// A guest has no tickets to read.
			expect(purchased.load).not.toHaveBeenCalled()
		})

		it('does not wait for the Series dates before showing the event', async () => {
			concertClient.listBySeries.mockReturnValue(new Promise(() => {}))
			const sut = build()
			sut.loading({ id: EVENT_ID })
			await vi.waitFor(() => expect(sut.state).toBe('ready'))
			expect(sut.seriesEvents).toEqual([])
		})
	})

	describe('what the page shows', () => {
		it('uses the cover image when the Series has one', async () => {
			concertClient.get.mockResolvedValue(protoConcert({ cover: true }))
			const sut = build()
			await open(sut)
			expect(sut.event?.coverUrl).toBe('https://images.example/large.webp')
		})

		it('shows the brand placeholder without a cover image', async () => {
			// @spec components/infrastructure/fan/web/route/event "Event without a cover image"
			const sut = build()
			await open(sut)
			expect(sut.event?.coverUrl).toBe('')
		})

		it('shows OPEN without START when no start time is announced', async () => {
			// @spec components/infrastructure/fan/web/route/event "Start time not announced"
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18, 30) }),
			)
			const sut = build()
			await open(sut)
			expect(sut.openTimeLabel).toBe('18:30')
			expect(sut.startTimeLabel).toBe('')
		})

		it('writes times in Japan time', async () => {
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18), start: jst(20, 19) }),
			)
			const sut = build()
			await open(sut)
			expect(sut.openTimeLabel).toBe('18:00')
			expect(sut.startTimeLabel).toBe('19:00')
		})

		it('keeps organizer text as entered and localizes labels in English', async () => {
			// @spec components/infrastructure/fan/web/route/event "English display language"
			userStore.currentLanguage = 'en'
			concertClient.get.mockResolvedValue(
				protoConcert({ title: '二夜連続ワンマン' }),
			)
			const sut = build()
			await open(sut)
			expect(sut.event?.title).toBe('二夜連続ワンマン')
			expect(sut.dateLabel).toBe('Fri, November 20, 2026')
			expect(sut.prefecture).toBe('Tokyo')
		})

		it('writes the date with weekday in Japanese', async () => {
			const sut = build()
			await open(sut)
			expect(sut.dateLabel).toBe('2026年11月20日(金)')
		})
	})

	describe('following', () => {
		it('follows the performer as a guest and shows it as followed', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest follows the artist"
			const sut = build()
			await open(sut)
			const performer = sut.event!.performers[0]
			expect(sut.isFollowed(performer)).toBe(false)

			await sut.toggleFollow(performer)

			// FollowStore keeps a guest's follows locally and migrates them into
			// the account on sign-up (GuestMigrationRequested).
			expect(follow.follow).toHaveBeenCalledWith({
				id: ARTIST_ID,
				name: 'The Band',
				mbid: '',
			})
			expect(sut.isFollowed(performer)).toBe(true)
		})

		it("loads a signed-in fan's follows so a followed performer shows as followed", async () => {
			auth = createMockAuth({ isAuthenticated: true })
			follow.listFollowed.mockImplementation(async () => {
				follow.followedArtists = [{ id: ARTIST_ID, name: 'The Band', mbid: '' }]
				return []
			})
			const sut = build()
			await open(sut)

			expect(follow.listFollowed).toHaveBeenCalled()
			expect(sut.followedIds.has(ARTIST_ID)).toBe(true)
		})

		it('ignores a follow tap until the follows have loaded', async () => {
			let release: () => void = () => {}
			follow.listFollowed.mockReturnValue(
				new Promise((r) => {
					release = () => r([])
				}),
			)
			const sut = build()
			sut.loading({ id: EVENT_ID })
			await vi.waitFor(() => expect(sut.state).toBe('ready'))

			expect(sut.followsLoaded).toBe(false)
			await sut.toggleFollow(sut.event!.performers[0])
			expect(follow.follow).not.toHaveBeenCalled()

			release()
			await vi.waitFor(() => expect(sut.followsLoaded).toBe(true))
		})

		it('unfollows a followed performer', async () => {
			follow.followedArtists = [{ id: ARTIST_ID, name: 'The Band', mbid: '' }]
			const sut = build()
			await open(sut)
			await sut.toggleFollow(sut.event!.performers[0])
			expect(follow.unfollow).toHaveBeenCalledWith(ARTIST_ID)
		})
	})

	describe('date tabs', () => {
		it('shows a tab per date of a two-day run, the displayed one selected', async () => {
			// @spec components/infrastructure/fan/web/route/event "Two-day run"
			const day2 = '019a0000-0000-7000-8000-0000000000e2'
			concertClient.listBySeries.mockResolvedValue([
				protoConcert({ day: 20 }),
				protoConcert({ id: day2, day: 21 }),
			])
			const sut = build()
			await open(sut)

			expect(sut.dateNav).toBe('tabs')
			expect(sut.dateTabs).toEqual([
				{ id: EVENT_ID, label: '11/20(金)', selected: true, cancelled: false },
				{ id: day2, label: '11/21(土)', selected: false, cancelled: false },
			])
		})

		it('lists the other dates of a six-stop tour instead of tabs', async () => {
			// @spec components/infrastructure/fan/web/route/event "Six-stop tour"
			concertClient.listBySeries.mockResolvedValue(
				[20, 21, 22, 23, 24, 25].map((day, i) =>
					protoConcert({ id: i === 0 ? EVENT_ID : `ev-${day}`, day }),
				),
			)
			const sut = build()
			await open(sut)

			expect(sut.dateNav).toBe('list')
			expect(sut.otherDates.map((d) => d.id)).toEqual([
				'ev-21',
				'ev-22',
				'ev-23',
				'ev-24',
				'ev-25',
			])
		})

		it('shows neither for a single date', async () => {
			const sut = build()
			await open(sut)
			expect(sut.dateNav).toBe('none')
		})
	})

	describe('ticket section', () => {
		it('says how many tickets a signed-in fan holds and links to Tickets', async () => {
			// @spec components/infrastructure/fan/web/route/event "Fan holding two tickets"
			auth = createMockAuth({ isAuthenticated: true })
			purchased = makePurchasedStore(new Map([[EVENT_ID, 2]]))
			const sut = build()
			await open(sut)

			expect(purchased.load).toHaveBeenCalled()
			expect(sut.showTicketSection).toBe(true)
			expect(sut.purchasedCount).toBe(2)
		})

		it('shows no purchased line when the only ticket is voided', async () => {
			// @spec components/infrastructure/fan/web/route/event "Voided tickets are not counted"
			// countIssuedByEvent (purchased-ticket-store.spec) leaves voided
			// tickets out of the counts the page reads.
			auth = createMockAuth({ isAuthenticated: true })
			purchased = makePurchasedStore(new Map())
			const sut = build()
			await open(sut)
			expect(sut.purchasedCount).toBe(0)
		})

		it('starts sign-up that returns to this page as an event-page sign-up', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest signs up to buy"
			const sut = build()
			await open(sut)
			expect(sut.isGuest).toBe(true)

			await sut.signUp()

			expect(auth.signUp).toHaveBeenCalledWith({
				origin: 'event-page',
				returnTo: `/events/${EVENT_ID}`,
				uiLocales: 'ja',
				source: 'event_page',
			})
		})
	})

	describe('sale', () => {
		/** A first-come sale of the event, open from 1 to 20 November. */
		function sale(o: Partial<TicketSale> = {}): TicketSale {
			return {
				id: 'sale-1',
				name: '一般発売',
				method: 'firstCome',
				saleStartTime: jst(1, 10),
				saleEndTime: jst(20, 18),
				verificationRequirement: 'none',
				eventIds: [EVENT_ID],
				...o,
			}
		}

		/** A lottery presale of the event, open from 1 to 10 November. */
		function presale(o: Partial<TicketSale> = {}): TicketSale {
			return sale({
				id: 'presale',
				name: 'ファンクラブ先行',
				method: 'lottery',
				saleStartTime: jst(1, 10),
				saleEndTime: jst(10, 23),
				...o,
			})
		}

		/** The event's S席 stock, 3000 yen, Available. */
		function stock(o: Partial<TicketStock> = {}): TicketStock {
			return {
				id: 'stock-s',
				eventId: EVENT_ID,
				seatTypeId: 'seat-s',
				seatTypeName: 'S席',
				price: 3000,
				state: 'available',
				lowStock: false,
				resaleOpen: false,
				...o,
			}
		}

		/** The A席 stock, 2000 yen, Available. */
		function stockA(o: Partial<TicketStock> = {}): TicketStock {
			return stock({
				id: 'stock-a',
				seatTypeId: 'seat-a',
				seatTypeName: 'A席',
				price: 2000,
				...o,
			})
		}

		function tickets(
			sales: TicketSale[],
			stocks: TicketStock[] = [stock()],
		): EventTicketSales {
			return { sales, stocks, perAccountLimit: 4 }
		}

		function row(sut: EventRoute, name: string) {
			const r = sut.stockRows.find((x) => x.stock.seatTypeName === name)
			if (!r) throw new Error(`no row for ${name}`)
			return r
		}

		it('reads the sales of the event', async () => {
			const sut = build()
			await open(sut)

			expect(ticketSaleClient.listByEvent).toHaveBeenCalledWith(
				EVENT_ID,
				expect.anything(),
			)
		})

		it('shows the seat type, price and few left without a count, with an action to buy', async () => {
			// @spec components/infrastructure/fan/web/route/event "On sale with few left"
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([sale()], [stock({ lowStock: true })]),
			)
			const sut = build()
			await open(sut)

			expect(sut.isSaleOpen).toBe(true)
			const s = row(sut, 'S席')
			expect(s.price).toBe('3,000')
			expect(s.stock.state).toBe('available')
			expect(s.stock.lowStock).toBe(true)
			expect(s.offered).toBe(true)
			expect(Object.keys(s.stock)).not.toContain('quantity')
			expect(sut.perAccountLimit).toBe(4)
		})

		it('shows each seat type of the event by its state', async () => {
			// @spec components/infrastructure/fan/web/route/event "Two seat types"
			auth = createMockAuth({ isAuthenticated: true })
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([sale()], [stock(), stockA({ state: 'soldOut' })]),
			)
			const sut = build()
			await open(sut)

			expect(sut.stockRows.map((r) => r.stock.seatTypeName)).toEqual([
				'S席',
				'A席',
			])
			expect(row(sut, 'S席').stock.state).toBe('available')
			expect(row(sut, 'S席').actionUrl).toBe(
				`/events/${EVENT_ID}/checkout/stock-s`,
			)
			expect(row(sut, 'A席').stock.state).toBe('soldOut')
		})

		it('starts sign-up from the action to buy and returns to the Event page', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest buys"
			ticketSaleClient.listByEvent.mockResolvedValue(tickets([sale()]))
			const sut = build()
			await open(sut)
			expect(sut.isGuest).toBe(true)

			await sut.signUp()

			expect(auth.signUp).toHaveBeenCalledWith({
				origin: 'event-page',
				returnTo: `/events/${EVENT_ID}`,
				uiLocales: 'ja',
				source: 'event_page',
			})
		})

		it('shows the opening date and time in Japan time before the sale opens', async () => {
			// @spec components/infrastructure/fan/web/route/event "Not yet on sale"
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([sale({ saleStartTime: jst(1, 13) })]),
			)
			const sut = build()
			await open(sut)

			expect(sut.isSaleUpcoming).toBe(true)
			expect(sut.isSaleOpen).toBe(false)
			expect(sut.saleStartLabel).toBe('2026年11月1日(日) 13:00')
			expect(row(sut, 'S席').price).toBe('3,000')
		})

		it('shows sold out with the note while every ticket is in a checkout', async () => {
			// @spec components/infrastructure/fan/web/route/event "Temporarily all held"
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([sale()], [stock({ state: 'allHeld' })]),
			)
			const sut = build()
			await open(sut)

			expect(row(sut, 'S席').stock.state).toBe('allHeld')
		})

		it('shows 公式リセール under a sold-out seat type whose resale is open', async () => {
			// @spec components/infrastructure/fan/web/route/event "Sold out with resale open"
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets(
					[sale()],
					[stock({ price: 5000, state: 'soldOut', resaleOpen: true })],
				),
			)
			const sut = build()
			await open(sut)

			const s = row(sut, 'S席')
			expect(s.stock.state).toBe('soldOut')
			expect(s.stock.resaleOpen).toBe(true)
			expect(s.price).toBe('5,000')
			expect(Object.keys(s.stock)).not.toContain('freeResaleCount')
		})

		it('offers only the seat type the fan already holds and names it', async () => {
			// @spec components/infrastructure/fan/web/route/event "Fan already holds another seat type"
			auth = createMockAuth({ isAuthenticated: true })
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([sale()], [stock(), stockA()]),
			)
			const held: HeldTickets = { stock: stock(), count: 2 }
			heldSeatTypes.heldTickets.mockResolvedValue(held)
			const sut = build()
			await open(sut)
			await vi.waitFor(() => expect(sut.heldStock).not.toBeNull())

			expect(sut.heldStock?.seatTypeName).toBe('S席')
			expect(row(sut, 'S席').offered).toBe(true)
			expect(row(sut, 'A席').offered).toBe(false)
			expect(heldSeatTypes.heldTickets).toHaveBeenCalledWith(
				EVENT_ID,
				expect.objectContaining({ perAccountLimit: 4 }),
				expect.anything(),
				true,
			)
		})

		it('asks a guest for no held seat type', async () => {
			ticketSaleClient.listByEvent.mockResolvedValue(tickets([sale()]))
			const sut = build()
			await open(sut)

			expect(heldSeatTypes.heldTickets).not.toHaveBeenCalled()
			expect(row(sut, 'S席').offered).toBe(true)
		})

		it('shows the upcoming general sale once the presale has ended', async () => {
			// @spec components/infrastructure/fan/web/route/event "Presale over, general sale upcoming"
			vi.setSystemTime(jst(15, 12))
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([
					presale(),
					sale({ saleStartTime: jst(20, 10), saleEndTime: jst(20, 18) }),
				]),
			)
			const sut = build()
			await open(sut)

			expect(sut.shownSale?.name).toBe('一般発売')
			expect(sut.isSaleUpcoming).toBe(true)
			expect(sut.saleStartLabel).toBe('2026年11月20日(金) 10:00')
		})

		it('shows an open lottery with its window, seat type, price and the action to enter', async () => {
			// @spec components/infrastructure/fan/web/route/event "Lottery open"
			auth = createMockAuth({ isAuthenticated: true })
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([presale()], [stock({ price: 8000 })]),
			)
			const sut = build()
			await open(sut)

			expect(sut.shownSale?.name).toBe('ファンクラブ先行')
			expect(sut.saleStartLabel).toBe('2026年11月1日(日) 10:00')
			expect(sut.saleEndLabel).toBe('2026年11月10日(火) 23:00')
			expect(sut.isSaleOpen).toBe(true)
			const s = row(sut, 'S席')
			expect(s.price).toBe('8,000')
			expect(s.actionUrl).toBe(`/events/${EVENT_ID}/lottery/presale/stock-s`)
		})

		it('offers no action to enter outside the lottery window', async () => {
			vi.setSystemTime(jst(11, 12))
			ticketSaleClient.listByEvent.mockResolvedValue(tickets([presale()]))
			const sut = build()
			await open(sut)

			expect(sut.shownSale?.method).toBe('lottery')
			expect(sut.isSaleOpen).toBe(false)
			expect(sut.isSaleEnded).toBe(true)
		})

		it('shows the general sale as ended once every sale has ended', async () => {
			// @spec components/infrastructure/fan/web/route/event "Every sale ended"
			vi.setSystemTime(jst(20, 18, 30))
			ticketSaleClient.listByEvent.mockResolvedValue(
				tickets([presale(), sale({ saleStartTime: jst(15, 10) })]),
			)
			const sut = build()
			await open(sut)

			expect(sut.shownSale?.name).toBe('一般発売')
			expect(sut.isSaleEnded).toBe(true)
		})

		it('shows no sale when no sale names the event', async () => {
			// @spec components/infrastructure/fan/web/route/event "No sale"
			const sut = build()
			await open(sut)

			expect(sut.shownSale).toBeNull()
			expect(sut.stockRows).toEqual([])
		})

		it('offers nothing for sale on a cancelled date of a published tour', async () => {
			// @spec components/infrastructure/fan/web/route/event "Shared link after cancellation"
			concertClient.get.mockResolvedValue(
				protoConcert({ state: PublishState.CANCELLED }),
			)
			ticketSaleClient.listByEvent.mockResolvedValue(tickets([sale()]))
			const sut = build()
			await open(sut)

			expect(sut.shownSale).toBeNull()
		})

		it('falls back to the sign-up hint when the sales cannot be read', async () => {
			ticketSaleClient.listByEvent.mockRejectedValue(new Error('unavailable'))
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('ready')
			expect(sut.shownSale).toBeNull()
		})
	})

	describe('states', () => {
		it('shows the cancelled banner and offers nothing for sale', async () => {
			// @spec components/infrastructure/fan/web/route/event "Shared link after cancellation"
			concertClient.get.mockResolvedValue(
				protoConcert({
					state: PublishState.CANCELLED,
					seriesState: PublishState.CANCELLED,
				}),
			)
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('ready')
			expect(sut.isCancelled).toBe(true)
			expect(sut.otherConcertsUrl).toBe(`/dashboard?artists=${ARTIST_ID}`)
		})

		it('shows the cancelled banner for one cancelled date of a published tour', async () => {
			// @spec components/infrastructure/fan/web/route/event "Shared link after cancellation"
			concertClient.get.mockResolvedValue(
				protoConcert({
					state: PublishState.CANCELLED,
					seriesState: PublishState.PUBLISHED,
				}),
			)
			const sut = build()
			await open(sut)

			expect(sut.isCancelled).toBe(true)
		})

		it('shows no banner on a published date and marks the cancelled date among the tabs', async () => {
			// @spec components/infrastructure/fan/web/route/event "Other date of a partly cancelled tour"
			const day2 = '019a0000-0000-7000-8000-0000000000e2'
			concertClient.listBySeries.mockResolvedValue([
				protoConcert({ day: 20 }),
				protoConcert({ id: day2, day: 21, state: PublishState.CANCELLED }),
			])
			const sut = build()
			await open(sut)

			expect(sut.isCancelled).toBe(false)
			expect(sut.dateTabs).toEqual([
				{ id: EVENT_ID, label: '11/20(金)', selected: true, cancelled: false },
				{ id: day2, label: '11/21(土)', selected: false, cancelled: true },
			])
		})

		it('marks a cancelled date in the list of other dates', async () => {
			// @spec components/infrastructure/fan/web/route/event "Other date of a partly cancelled tour"
			concertClient.listBySeries.mockResolvedValue(
				[20, 21, 22, 23, 24, 25].map((day, i) =>
					protoConcert({
						id: i === 0 ? EVENT_ID : `ev-${day}`,
						day,
						state: day === 22 ? PublishState.CANCELLED : PublishState.PUBLISHED,
					}),
				),
			)
			const sut = build()
			await open(sut)

			expect(sut.isCancelled).toBe(false)
			expect(
				sut.otherDates.filter((d) => d.cancelled).map((d) => d.id),
			).toEqual(['ev-22'])
		})

		it('says the event has ended the day after the show, with no ticket section', async () => {
			// @spec components/infrastructure/fan/web/route/event "Day after the show"
			// 2026-11-21 00:30 in Japan is still 2026-11-20 in UTC.
			vi.setSystemTime(jst(21, 0, 30))
			const sut = build()
			await open(sut)

			expect(sut.isEnded).toBe(true)
			expect(sut.showTicketSection).toBe(false)
		})

		it('is not ended on the day of the show in Japan', async () => {
			vi.setSystemTime(jst(20, 23, 30))
			const sut = build()
			await open(sut)
			expect(sut.isEnded).toBe(false)
		})

		it('shows the not-found view for an event without a page', async () => {
			// @spec components/infrastructure/fan/web/route/event "Unlisted event"
			concertClient.get.mockRejectedValue(
				new ConnectError('event page not found', Code.NotFound),
			)
			const sut = build()
			await open(sut)
			expect(sut.state).toBe('not-found')
			expect(sut.event).toBeNull()
		})

		it('offers a retry on a network failure, and retrying loads the event', async () => {
			// @spec components/infrastructure/fan/web/route/event "Network failure"
			concertClient.get.mockRejectedValueOnce(
				new ConnectError('unavailable', Code.Unavailable),
			)
			const sut = build()
			await open(sut)
			expect(sut.state).toBe('error')

			sut.retry()
			await vi.waitFor(() => expect(sut.state).toBe('ready'))
			expect(sut.event?.id).toBe(EVENT_ID)
		})
	})

	describe('share and calendar', () => {
		it('shares the canonical event URL without any query', async () => {
			window.history.replaceState(null, '', `/events/${EVENT_ID}?ref=member-a`)
			const share = vi.fn().mockResolvedValue(undefined)
			Object.assign(navigator, { share })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(share).toHaveBeenCalledWith({
				title: 'ONE MAN LIVE',
				url: `${window.location.origin}/events/${EVENT_ID}`,
			})
			Reflect.deleteProperty(navigator, 'share')
		})

		it('reports a completed share with the Event', async () => {
			// @spec components/infrastructure/fan/web/route/event "Share"
			Object.assign(navigator, { share: vi.fn().mockResolvedValue(undefined) })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(analytics.capture.mock.calls).toEqual([
				[
					Events.ConcertShared,
					{ event_id: EVENT_ID, method: 'share_sheet', outcome: 'completed' },
				],
			])
			Reflect.deleteProperty(navigator, 'share')
		})

		it('reports a share sheet the fan closed as cancelled', async () => {
			const abort = Object.assign(new Error('closed'), { name: 'AbortError' })
			Object.assign(navigator, { share: vi.fn().mockRejectedValue(abort) })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(analytics.capture).toHaveBeenCalledWith(Events.ConcertShared, {
				event_id: EVENT_ID,
				method: 'share_sheet',
				outcome: 'cancelled',
			})
			Reflect.deleteProperty(navigator, 'share')
		})

		it('copies the link where the Web Share API is missing', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined)
			Object.assign(navigator, { clipboard: { writeText } })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(writeText).toHaveBeenCalledWith(
				`${window.location.origin}/events/${EVENT_ID}`,
			)
		})

		it('downloads an .ics carrying the event start', async () => {
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18), start: jst(20, 19) }),
			)
			const blobs: Blob[] = []
			const createObjectURL = vi.fn((b: Blob) => {
				blobs.push(b)
				return 'blob:ics'
			})
			Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, 'click')
				.mockImplementation(() => {})
			const sut = build()
			await open(sut)

			sut.addToCalendar()

			expect(click).toHaveBeenCalled()
			expect(analytics.capture).toHaveBeenCalledWith(
				Events.ConcertCalendarAdded,
				{ event_id: EVENT_ID, surface: 'event_page' },
			)
			const ics = await blobs[0].text()
			// 19:00 in Japan is 10:00 UTC.
			expect(ics).toContain('DTSTART:20261120T100000Z')
			expect(ics).toContain('SUMMARY:ONE MAN LIVE')
			expect(ics).toContain(`URL:${window.location.origin}/events/${EVENT_ID}`)
		})
	})

	describe('referral link', () => {
		const OTHER_SERIES_ID = '019a0000-0000-7000-8000-0000000000a2'

		function openedWith(search: string): void {
			window.history.replaceState({}, '', `/events/${EVENT_ID}${search}`)
		}

		function kept(): unknown {
			return JSON.parse(localStorage.getItem('referral') ?? 'null')
		}

		beforeEach(() => {
			localStorage.clear()
		})

		afterEach(() => {
			localStorage.clear()
			window.history.replaceState({}, '', '/')
		})

		it('keeps the code for the Series until 7 days after the page was opened', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest opens a referral link"
			openedWith('?ref=member-a')
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('ready')
			expect(sut.event?.title).toBe('ONE MAN LIVE')
			expect(kept()).toEqual({
				code: 'member-a',
				seriesId: SERIES_ID,
				expiresAt: jst(8, 12).getTime(),
			})
			// Nothing the page links to carries the code.
			expect(sut.shareUrl).toBe(`${window.location.origin}/events/${EVENT_ID}`)
		})

		it('keeps an uppercase code lowercased', async () => {
			// @spec components/infrastructure/fan/web/route/event "Uppercase code"
			// @spec components/entity/referral "One code whatever the case in links"
			openedWith('?ref=Member-A')
			const sut = build()
			await open(sut)

			expect(kept()).toMatchObject({ code: 'member-a', seriesId: SERIES_ID })
		})

		it('replaces the kept code with a newer link and a new 7-day expiry', async () => {
			// @spec components/infrastructure/fan/web/route/event "Newer link replaces the code"
			localStorage.setItem(
				'referral',
				JSON.stringify({
					code: 'member-a',
					seriesId: OTHER_SERIES_ID,
					expiresAt: jst(5, 12).getTime(),
				}),
			)
			openedWith('?ref=member-b')
			const sut = build()
			await open(sut)

			expect(kept()).toEqual({
				code: 'member-b',
				seriesId: SERIES_ID,
				expiresAt: jst(8, 12).getTime(),
			})
		})

		it('ignores a malformed code and keeps the code it had', async () => {
			// @spec components/infrastructure/fan/web/route/event "Malformed code ignored"
			const before = {
				code: 'member-a',
				seriesId: SERIES_ID,
				expiresAt: jst(5, 12).getTime(),
			}
			localStorage.setItem('referral', JSON.stringify(before))
			openedWith('?ref=member_b')
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('ready')
			expect(kept()).toEqual(before)
		})

		it('keeps nothing when opened without ref', async () => {
			openedWith('')
			const sut = build()
			await open(sut)

			expect(kept()).toBeNull()
		})

		it('keeps no code for an event that is not found', async () => {
			// @spec components/infrastructure/fan/web/route/event "Unknown event"
			concertClient.get.mockRejectedValue(
				new ConnectError('event page not found', Code.NotFound),
			)
			openedWith('?ref=member-a')
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('not-found')
			expect(kept()).toBeNull()
		})

		it('starts sign-up with the return path without the query', async () => {
			openedWith('?ref=member-a')
			const sut = build()
			await open(sut)

			await sut.signUp()

			expect(auth.signUp).toHaveBeenCalledWith({
				origin: 'event-page',
				returnTo: `/events/${EVENT_ID}`,
				uiLocales: 'ja',
				source: 'event_page',
			})
			expect(kept()).toMatchObject({ code: 'member-a' })
		})
	})
})
