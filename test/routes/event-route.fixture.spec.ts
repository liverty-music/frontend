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
import type { TicketSale } from '../../src/entities/ticket-sale'
import ja from '../../src/locales/ja/translation.json'
import { EventRoute } from '../../src/routes/event/event-route'
import { IAuthService } from '../../src/services/auth-service'
import { IFollowStore } from '../../src/services/follow-store'
import { IPurchasedTicketStore } from '../../src/services/purchased-ticket-store'
import { IUserStore } from '../../src/services/user-store'
import { createMockAuth } from '../helpers/mock-auth'

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
					listByEvent: vi.fn().mockResolvedValue([]),
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

/** Render the real Event page in Japanese with the given sales. */
async function renderSales(sales: TicketSale[], authenticated: boolean) {
	const concert = fixtureConcert()
	const fixture = await createFixture(
		'<event-route component.ref="route"></event-route>',
		class Host {
			public route!: EventRoute
		},
		[
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
				listByEvent: vi.fn().mockResolvedValue(sales),
			}),
		],
	).started
	const route = fixture.component.route
	route.loading({ id: EVENT_ID })
	await vi.waitFor(() => expect(route.sales).toHaveLength(sales.length))
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
		ticketType: {
			id: 'type-1',
			eventId: EVENT_ID,
			price: 3000,
			perAccountLimit: 4,
			state: 'onSale',
			lowStock: true,
		},
		...o,
	}
}

describe('EventRoute ticket section (fixture)', () => {
	it('shows the price, few left and the action to buy, with no count', async () => {
		// @spec components/infrastructure/fan/web/route/event "On sale with few left"
		const fixture = await renderSales([onSale()], false)
		const section = fixture.appHost.querySelector(
			'[data-testid="event-sale"]',
		) as HTMLElement

		expect(
			section.querySelector('[data-testid="event-sale-price"]')?.textContent,
		).toBe('3,000円（税込）')
		expect(
			section.querySelector('[data-testid="event-sale-low"]')?.textContent,
		).toBe('残りわずか')
		expect(section.querySelector('[data-testid="event-buy"]')).not.toBeNull()
		expect(section.textContent).not.toMatch(/\d+枚/)
		await fixture.stop(true)
	})

	it('shows an open lottery by name with its window, price and the action to enter', async () => {
		// @spec components/infrastructure/fan/web/route/event "Lottery open"
		const lottery = onSale({
			id: 'presale',
			name: 'ファンクラブ先行',
			method: 'lottery',
			ticketType: {
				id: 'presale-type',
				eventId: EVENT_ID,
				price: 8000,
				perAccountLimit: 4,
				state: 'ended',
				lowStock: false,
			},
		})
		const fixture = await renderSales([lottery], true)
		const section = fixture.appHost.querySelector(
			'[data-testid="event-sale"]',
		) as HTMLElement

		expect(
			section.querySelector('[data-testid="event-sale-name"]')?.textContent,
		).toBe('ファンクラブ先行')
		expect(
			section.querySelector('[data-testid="event-sale-window"]')?.textContent,
		).toContain('受付期間')
		expect(
			section.querySelector('[data-testid="event-sale-price"]')?.textContent,
		).toBe('8,000円（税込）')
		const enter = section.querySelector(
			'[data-testid="event-enter"]',
		) as HTMLAnchorElement
		expect(enter.getAttribute('href')).toBe(
			`/events/${EVENT_ID}/lottery/presale-type`,
		)
		expect(section.querySelector('[data-testid="event-buy"]')).toBeNull()
		await fixture.stop(true)
	})

	it('shows no sale when no sale offers the event', async () => {
		// @spec components/infrastructure/fan/web/route/event "No sale"
		const fixture = await renderSales([], true)
		expect(
			fixture.appHost.querySelector('[data-testid="event-sale"]'),
		).toBeNull()
		await fixture.stop(true)
	})
})
