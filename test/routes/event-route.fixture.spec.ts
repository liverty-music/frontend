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
					get: vi.fn().mockResolvedValue(null),
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
