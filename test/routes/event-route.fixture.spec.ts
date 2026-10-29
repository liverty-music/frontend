import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import {
	PublishState,
	SeriesSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { observable, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import {
	concertResolver,
	IConcertRpcClient,
} from '../../src/adapter/rpc/client/concert-client'
import { ITicketSaleRpcClient } from '../../src/adapter/rpc/client/ticket-sale-client'
import { EventDateTabs } from '../../src/components/event-date-tabs/event-date-tabs'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'
import type { Artist } from '../../src/entities/artist'
import {
	type EventTicketSales,
	NO_TICKET_SALES,
	type TicketSale,
	type TicketStock,
} from '../../src/entities/ticket-sale'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import ja from '../../src/locales/ja/translation.json'
import { EventRoute } from '../../src/routes/event/event-route'
import { IAuthService } from '../../src/services/auth-service'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
import { IFollowStore } from '../../src/services/follow-store'
import {
	type HeldTickets,
	IHeldSeatTypeService,
} from '../../src/services/held-seat-type-service'
import { IPurchasedTicketStore } from '../../src/services/purchased-ticket-store'
import { IUserStore } from '../../src/services/user-store'
import { createMockAnalytics } from '../helpers/mock-analytics'
import { createMockAuth } from '../helpers/mock-auth'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'
const ARTIST_ID = '019a0000-0000-7000-8000-0000000000b1'

/** A follow store whose list is observable, like the real FollowStore. */
class ObservableFollowStore {
	@observable public followedArtists: Artist[] = []
	public get followedIds(): ReadonlySet<string> {
		return new Set(this.followedArtists.map((a) => a.id))
	}
	public listFollowed = vi.fn(async () => [])
	public follow = vi.fn(async (artist: Artist) => {
		this.followedArtists = [...this.followedArtists, artist]
	})
	public unfollow = vi.fn(async (id: string) => {
		this.followedArtists = this.followedArtists.filter((a) => a.id !== id)
	})
}

describe('EventRoute (fixture)', () => {
	it('shows a performer as followed as soon as the follow is stored', async () => {
		// @spec components/infrastructure/fan/web/route/event "Guest follows the artist"
		const follow = new ObservableFollowStore()
		const concert = concertResolver(
			[
				create(SeriesSchema, {
					id: { value: 's1' },
					title: { value: 'ONE MAN LIVE' },
					organizerId: { value: 'org-1' },
					publishState: PublishState.PUBLISHED,
				}),
			],
			[
				create(ArtistSchema, {
					id: { value: ARTIST_ID },
					name: { value: 'The Band' },
				}),
			],
		)(
			create(ConcertSchema, {
				event: {
					id: { value: EVENT_ID },
					localDate: { value: { year: 2099, month: 11, day: 20 } },
					listedVenueName: { value: 'Shibuya WWW' },
					seriesId: { value: 's1' },
				},
				artistIds: [{ value: ARTIST_ID }],
			}),
		)
		const fixture = await createFixture(
			'<event-route component.ref="route"></event-route>',
			class Host {
				public route!: EventRoute
			},
			[
				// Key actions add a step for the error report.
				Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
				Registration.instance(IAnalyticsService, createMockAnalytics()),
				I18nConfiguration.customize((o) => {
					o.initOptions = { lng: 'en', resources: { en: { translation: {} } } }
				}),
				EventRoute,
				EventDateTabs,
				SvgIcon,
				Registration.instance(IConcertRpcClient, {
					get: vi.fn().mockResolvedValue(concert),
					listBySeries: vi.fn().mockResolvedValue([concert]),
				}),
				Registration.instance(IAuthService, createMockAuth()),
				Registration.instance(IFollowStore, follow),
				Registration.instance(IPurchasedTicketStore, {
					countFor: () => 0,
					load: vi.fn(),
				}),
				Registration.instance(IUserStore, { currentLanguage: 'en' }),
				Registration.instance(ITicketSaleRpcClient, {
					listByEvent: vi.fn().mockResolvedValue(NO_TICKET_SALES),
				}),
				Registration.instance(IHeldSeatTypeService, {
					heldTickets: vi.fn().mockResolvedValue(null),
				}),
			],
		).started

		const route = fixture.component.route
		route.loading({ id: EVENT_ID })
		await vi.waitFor(() => expect(route.state).toBe('ready'))
		await tasksSettled()

		const button = () =>
			fixture.appHost.querySelector(
				'[data-testid="event-follow"]',
			) as HTMLElement
		expect(button().getAttribute('aria-pressed')).toBe('false')

		button().click()
		await vi.waitFor(() => expect(follow.follow).toHaveBeenCalled())
		await tasksSettled()

		expect(button().getAttribute('aria-pressed')).toBe('true')
		await fixture.stop(true)
	})
})

/** The fixture concert of the 20 November 2099 event. */
function fixtureConcert() {
	return concertResolver(
		[
			create(SeriesSchema, {
				id: { value: 's1' },
				title: { value: 'ONE MAN LIVE' },
				organizerId: { value: 'org-1' },
				publishState: PublishState.PUBLISHED,
			}),
		],
		[
			create(ArtistSchema, {
				id: { value: ARTIST_ID },
				name: { value: 'The Band' },
			}),
		],
	)(
		create(ConcertSchema, {
			event: {
				id: { value: EVENT_ID },
				localDate: { value: { year: 2099, month: 11, day: 20 } },
				listedVenueName: { value: 'Shibuya WWW' },
				seriesId: { value: 's1' },
			},
			artistIds: [{ value: ARTIST_ID }],
		}),
	)
}

/**
 * Render the real Event page in Japanese with the given sales and stocks;
 * `held` is what the signed-in fan already holds for the event.
 */
async function renderSales(
	tickets: EventTicketSales,
	authenticated: boolean,
	held: HeldTickets | null = null,
) {
	const concert = fixtureConcert()
	const fixture = await createFixture(
		'<event-route component.ref="route"></event-route>',
		class Host {
			public route!: EventRoute
		},
		[
			// Key actions add a step for the error report.
			Registration.instance(IErrorBoundaryService, createMockErrorBoundary()),
			Registration.instance(IAnalyticsService, createMockAnalytics()),
			I18nConfiguration.customize((o) => {
				o.initOptions = { lng: 'ja', resources: { ja: { translation: ja } } }
			}),
			EventRoute,
			EventDateTabs,
			SvgIcon,
			Registration.instance(IConcertRpcClient, {
				get: vi.fn().mockResolvedValue(concert),
				listBySeries: vi.fn().mockResolvedValue([concert]),
			}),
			Registration.instance(
				IAuthService,
				createMockAuth({ isAuthenticated: authenticated }),
			),
			Registration.instance(IFollowStore, new ObservableFollowStore()),
			Registration.instance(IPurchasedTicketStore, {
				countFor: () => 0,
				load: vi.fn(),
			}),
			Registration.instance(IUserStore, { currentLanguage: 'ja' }),
			Registration.instance(ITicketSaleRpcClient, {
				listByEvent: vi.fn().mockResolvedValue(tickets),
			}),
			Registration.instance(IHeldSeatTypeService, {
				heldTickets: vi.fn().mockResolvedValue(held),
			}),
		],
	).started
	const route = fixture.component.route
	route.loading({ id: EVENT_ID })
	await vi.waitFor(() =>
		expect(route.tickets.sales).toHaveLength(tickets.sales.length),
	)
	if (held) await vi.waitFor(() => expect(route.heldStock).not.toBeNull())
	await tasksSettled()
	return fixture
}

const DAY = 24 * 60 * 60 * 1000

function onSale(o: Partial<TicketSale> = {}): TicketSale {
	return {
		id: 'sale-1',
		name: '一般発売',
		method: 'firstCome',
		saleStartTime: new Date(Date.now() - DAY),
		saleEndTime: new Date(Date.now() + DAY),
		verificationRequirement: 'none',
		eventIds: [EVENT_ID],
		...o,
	}
}

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

const A_SEAT = stock({
	id: 'stock-a',
	seatTypeId: 'seat-a',
	seatTypeName: 'A席',
	price: 2000,
})

function tickets(
	sales: TicketSale[],
	stocks: TicketStock[] = [stock()],
): EventTicketSales {
	return { sales, stocks, perAccountLimit: 4 }
}

/** The rendered row of a seat type in the ticket section. */
function rowOf(host: HTMLElement, name: string): HTMLElement {
	const row = [
		...host.querySelectorAll<HTMLElement>('[data-testid="event-stock"]'),
	].find(
		(r) =>
			r.querySelector('[data-testid="event-stock-name"]')?.textContent === name,
	)
	if (!row) throw new Error(`no row for ${name}`)
	return row
}

const testid = (el: HTMLElement, id: string) =>
	el.querySelector(`[data-testid="${id}"]`)

describe('EventRoute ticket section (fixture)', () => {
	it('shows the seat type, its price, few left and the action to buy, with no count', async () => {
		// @spec components/infrastructure/fan/web/route/event "On sale with few left"
		const fixture = await renderSales(
			tickets([onSale()], [stock({ lowStock: true })]),
			false,
		)
		const section = testid(fixture.appHost, 'event-sale') as HTMLElement
		const s = rowOf(section, 'S席')

		expect(testid(s, 'event-sale-price')?.textContent).toBe('3,000円（税込）')
		expect(testid(s, 'event-sale-low')?.textContent).toBe('残りわずか')
		expect(testid(s, 'event-buy')).not.toBeNull()
		expect(testid(section, 'event-sale-limit')?.textContent).toContain('4枚')
		expect(s.textContent).not.toMatch(/\d+枚/)
		await fixture.stop(true)
	})

	it('shows each seat type: the available one with the action to buy, the sold-out one as 売り切れ', async () => {
		// @spec components/infrastructure/fan/web/route/event "Two seat types"
		const fixture = await renderSales(
			tickets([onSale()], [stock(), { ...A_SEAT, state: 'soldOut' }]),
			true,
		)
		const s = rowOf(fixture.appHost, 'S席')
		const a = rowOf(fixture.appHost, 'A席')

		expect(
			(testid(s, 'event-buy') as HTMLAnchorElement).getAttribute('href'),
		).toBe(`/events/${EVENT_ID}/checkout/stock-s`)
		expect(testid(a, 'event-sale-sold-out')?.textContent).toBe('売り切れ')
		expect(testid(a, 'event-buy')).toBeNull()
		await fixture.stop(true)
	})

	it('shows the opening time and each seat type with its price, and no action to buy', async () => {
		// @spec components/infrastructure/fan/web/route/event "Not yet on sale"
		const fixture = await renderSales(
			tickets([
				onSale({
					saleStartTime: new Date(Date.now() + DAY),
					saleEndTime: new Date(Date.now() + 2 * DAY),
				}),
			]),
			false,
		)
		const section = testid(fixture.appHost, 'event-sale') as HTMLElement

		expect(testid(section, 'event-sale-opens')?.textContent).toContain(
			'販売開始',
		)
		expect(testid(rowOf(section, 'S席'), 'event-sale-price')?.textContent).toBe(
			'3,000円（税込）',
		)
		expect(testid(section, 'event-buy')).toBeNull()
		await fixture.stop(true)
	})

	it('shows an all-held seat type as 売り切れ with the note', async () => {
		// @spec components/infrastructure/fan/web/route/event "Temporarily all held"
		const fixture = await renderSales(
			tickets([onSale()], [stock({ state: 'allHeld' })]),
			false,
		)
		const s = rowOf(fixture.appHost, 'S席')

		expect(testid(s, 'event-sale-sold-out')?.textContent).toBe('売り切れ')
		expect(testid(s, 'event-sale-all-held')?.textContent).toContain('数分後')
		expect(testid(s, 'event-buy')).toBeNull()
		await fixture.stop(true)
	})

	it('shows 公式リセール under a sold-out seat type with the listing note and no action', async () => {
		// @spec components/infrastructure/fan/web/route/event "Sold out with resale open"
		const fixture = await renderSales(
			tickets(
				[onSale()],
				[stock({ price: 5000, state: 'soldOut', resaleOpen: true })],
			),
			true,
		)
		const s = rowOf(fixture.appHost, 'S席')

		expect(testid(s, 'event-sale-sold-out')?.textContent).toBe('売り切れ')
		expect(testid(s, 'event-resale')?.textContent).toContain('公式リセール')
		expect(testid(s, 'event-resale-listing')?.textContent).toContain(
			'チケット画面',
		)
		expect(testid(s, 'event-buy')).toBeNull()
		expect(s.textContent).not.toMatch(/\d+枚/)
		await fixture.stop(true)
	})

	it('offers only the held seat type and names it', async () => {
		// @spec components/infrastructure/fan/web/route/event "Fan already holds another seat type"
		const fixture = await renderSales(
			tickets([onSale()], [stock(), A_SEAT]),
			true,
			{ stock: stock(), count: 2 },
		)
		const section = testid(fixture.appHost, 'event-sale') as HTMLElement

		expect(testid(rowOf(section, 'S席'), 'event-buy')).not.toBeNull()
		expect(testid(rowOf(section, 'A席'), 'event-buy')).toBeNull()
		expect(testid(section, 'event-sale-held')?.textContent).toContain(
			'この日程でお持ちのチケットはS席です',
		)
		await fixture.stop(true)
	})

	it('shows an open lottery by name with its window, seat type, price and the action to enter', async () => {
		// @spec components/infrastructure/fan/web/route/event "Lottery open"
		const lottery = onSale({
			id: 'presale',
			name: 'ファンクラブ先行',
			method: 'lottery',
		})
		const fixture = await renderSales(
			tickets([lottery], [stock({ price: 8000 })]),
			true,
		)
		const section = testid(fixture.appHost, 'event-sale') as HTMLElement
		const s = rowOf(section, 'S席')

		expect(testid(section, 'event-sale-name')?.textContent).toBe(
			'ファンクラブ先行',
		)
		expect(testid(section, 'event-sale-window')?.textContent).toContain(
			'受付期間',
		)
		expect(testid(s, 'event-sale-price')?.textContent).toBe('8,000円（税込）')
		const enter = testid(s, 'event-enter') as HTMLAnchorElement
		expect(enter.getAttribute('href')).toBe(
			`/events/${EVENT_ID}/lottery/presale/stock-s`,
		)
		expect(testid(section, 'event-buy')).toBeNull()
		await fixture.stop(true)
	})

	it('shows no sale when no sale names the event', async () => {
		// @spec components/infrastructure/fan/web/route/event "No sale"
		const fixture = await renderSales(NO_TICKET_SALES, true)
		expect(testid(fixture.appHost, 'event-sale')).toBeNull()
		await fixture.stop(true)
	})
})
