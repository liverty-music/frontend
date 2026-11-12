import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertRoute } from '../../../organizer/concert/concert-route'
import { ConcertsRoute } from '../../../organizer/concerts/concerts-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeatTypeClient } from '../../../organizer/services/seat-type-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { authoredSeries } from '../authored-series'

const SPEC = 'components/infrastructure/organizer/web/global/organizer-shell'

const BAND_A = { id: { value: 'a-1' }, name: { value: 'Band A' } }
const BAND_B = { id: { value: 'a-2' }, name: { value: 'Band B' } }

const at = (day: string, time: string) =>
	timestampFromDate(new Date(`${day}T${time}:00+09:00`))

/** XX × YY 2026: Band A and Band B, both represented, perform. */
const XX_YY = authoredSeries({
	series: { id: { value: 's-xy' }, title: { value: 'XX × YY 2026' } },
	performers: [BAND_A, BAND_B],
	events: [
		{
			id: { value: 'e-xy' },
			localDate: { value: { year: 2026, month: 11, day: 21 } },
			startTime: { value: at('2026-11-21', '17:00') },
			publishState: PublishState.PUBLISHED,
		},
	],
})
/** Band A's own tour. */
const XX_TOUR = authoredSeries({
	series: { id: { value: 's-tour' }, title: { value: 'XX Tour 2026' } },
	performers: [BAND_A],
	events: [
		{
			id: { value: 'e-1103' },
			localDate: { value: { year: 2026, month: 11, day: 3 } },
			startTime: { value: at('2026-11-03', '18:00') },
			publishState: PublishState.PUBLISHED,
		},
	],
})
/** Only Band B performs in YY Live. */
const YY_LIVE = authoredSeries({
	series: { id: { value: 's-yy' }, title: { value: 'YY Live' } },
	performers: [BAND_B],
	events: [
		{
			id: { value: 'e-yy' },
			localDate: { value: { year: 2026, month: 12, day: 1 } },
			startTime: { value: at('2026-12-01', '19:00') },
			publishState: PublishState.DRAFT,
		},
	],
})

/** The clients every screen below reads, answering for XX Records. */
function clients(
	artists: Array<typeof BAND_A>,
	concerts = [XX_TOUR, XX_YY, YY_LIVE],
) {
	return [
		Registration.instance(IOrganizerClient, {
			get: vi.fn().mockResolvedValue(
				create(OrganizerSchema, {
					id: { value: 'org-1' },
					name: { value: 'XX Records' },
				}),
			),
		}),
		Registration.instance(IArtistClient, {
			list: vi
				.fn()
				.mockResolvedValue(artists.map((a) => create(ArtistSchema, a))),
		}),
		Registration.instance(ISeriesClient, {
			list: vi.fn().mockResolvedValue(concerts),
		}),
		Registration.instance(ITicketSaleClient, {
			listByEvent: vi.fn().mockResolvedValue([]),
		}),
		Registration.instance(ITicketStockClient, {
			listByEvent: vi.fn().mockResolvedValue({ ticketStocks: [] }),
		}),
		Registration.instance(ISeatTypeClient, {
			listBySeries: vi.fn().mockResolvedValue([]),
		}),
		Registration.instance(IRouter, { load: vi.fn() }),
	]
}

describe('concerts under an Artist', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	/** The concerts of the Artist in the address, as the page lists them. */
	async function concertsOf(artistId: string) {
		const fixture = createFixture(
			'<concerts-route></concerts-route>',
			class {},
			[ConsoleI18nConfiguration, ConcertsRoute, ...clients([BAND_A, BAND_B])],
		)
		const context = fixture.container.get(IConsoleContext)
		await context.load()
		context.follow({ organizerId: 'org-1', artistId })
		await fixture.startPromise
		const host = fixture.appHost.querySelector('concerts-route') as Element
		const vm = CustomElement.for<ConcertsRoute>(host).viewModel
		vm.loading({ organizerId: 'org-1', artistId })
		await vm.load()
		await tasksSettled()
		const rows = vm.rows.map((row) => ({
			title: row.cells.title,
			href: row.href,
		}))
		vm.detaching()
		await fixture.tearDown()
		return rows
	}

	/** The breadcrumb the concert page sets, opened under the Artist in the address. */
	async function crumbsOf(artistId: string) {
		const set = vi.fn()
		const fixture = createFixture('<div></div>', class {}, [
			ConsoleI18nConfiguration,
			...clients([BAND_A, BAND_B]),
			Registration.instance(IBreadcrumbs, { set }),
		])
		const context = fixture.container.get(IConsoleContext)
		await context.load()
		context.follow({ organizerId: 'org-1', artistId })
		await fixture.startPromise
		const vm: ConcertRoute = fixture.container.invoke(ConcertRoute)
		vm.loading({ organizerId: 'org-1', artistId, seriesId: 's-xy' })
		await vm.load()
		await tasksSettled()
		const trail = set.mock.calls.at(-1)?.[0]
		vm.detaching()
		await fixture.tearDown()
		return trail
	}

	it(`@spec ${SPEC} "Co-headlined concert"`, async () => {
		// The concert is listed in the concerts of each Artist...
		const first = await concertsOf('a-1')
		expect(first.filter((r) => r.title === 'XX × YY 2026')).toHaveLength(1)
		expect(first.some((r) => r.title === 'YY Live')).toBe(false)
		const second = await concertsOf('a-2')
		const shared = second.filter((r) => r.title === 'XX × YY 2026')
		expect(shared).toHaveLength(1)
		expect(second.some((r) => r.title === 'XX Tour 2026')).toBe(false)
		expect(second.some((r) => r.title === 'YY Live')).toBe(true)

		// ...opens under either Artist's address...
		expect(first.find((r) => r.title === 'XX × YY 2026')?.href).toBe(
			'/organizers/org-1/artists/a-1/series/s-xy',
		)
		expect(shared[0].href).toBe('/organizers/org-1/artists/a-2/series/s-xy')

		// ...and its breadcrumb follows the Artist in the address.
		expect((await crumbsOf('a-2'))?.[0]).toMatchObject({
			labelKey: 'shell.nav.concerts',
			href: '/organizers/org-1/artists/a-2/series',
		})
		expect((await crumbsOf('a-1'))?.[0]).toMatchObject({
			labelKey: 'shell.nav.concerts',
			href: '/organizers/org-1/artists/a-1/series',
		})
	})

	it(`@spec ${SPEC} "No represented Artist yet"`, async () => {
		const fixture = createFixture(
			'<concerts-route></concerts-route>',
			class {},
			[ConsoleI18nConfiguration, ConcertsRoute, ...clients([])],
		)
		await fixture.startPromise
		const host = fixture.appHost.querySelector('concerts-route') as Element
		const vm = CustomElement.for<ConcertsRoute>(host).viewModel
		// 公演 opens this page itself: there is no Artist to forward to.
		await fixture.container.get(IConsoleContext).load()
		expect(fixture.container.get(IConsoleContext).concertsHref).toBe(
			'/organizers/org-1/artists',
		)
		expect(await vm.canLoad({ organizerId: 'org-1' })).toBe(true)
		vm.loading({ organizerId: 'org-1' })
		await vm.load()
		await tasksSettled()

		const text = host.textContent ?? ''
		expect(text).toContain('所属アーティストがまだいません')
		expect(text).toContain('所属アーティストの追加は Liverty Music が承ります')
		expect(text).not.toContain('公演をつくる')
		expect(host.querySelector('extended-fab')).toBeNull()
		vm.detaching()
		await fixture.tearDown()
	})
})
