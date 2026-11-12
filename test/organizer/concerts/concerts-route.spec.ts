import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertsRoute } from '../../../organizer/concerts/concerts-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IClock } from '../../../organizer/services/clock'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleUi } from '../../../organizer/ui'
import {
	artistsNamed,
	authored,
	type ConcertSpec,
	NO_SALES,
	openLottery,
	XX_SOLO,
	XX_TOUR,
} from '../concert-fixtures'
import { controlNamed, deepAll, deepText } from '../console-dom'

/**
 * The concerts of a represented Artist as the member reads them: the real
 * route and list components, with the series, sales, organizer and artist
 * clients faked. The window's width (list or table) is a CSS container query
 * that jsdom does not compute, so both forms are in the DOM here and the
 * switch is checked in `e2e/functional/organizer-concerts.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concerts'

/** 2026-10-28 10:00 JST. */
const NOW = new Date('2026-10-28T10:00:00+09:00').getTime()

/** Only Band B performs in YY Live. */
const YY_LIVE: ConcertSpec = {
	id: 's-yy',
	title: 'YY Live',
	performers: [{ id: 'a-2', name: 'Band B' }],
	events: [{ id: 'e-yy', date: '2026-12-01', start: '19:00', venue: 'O-EAST' }],
}

async function mount(
	opts: {
		concerts?: ConcertSpec[]
		list?: ReturnType<typeof vi.fn>
		artist?: string
		artists?: string[]
	} = {},
) {
	const list =
		opts.list ??
		vi
			.fn()
			.mockResolvedValue((opts.concerts ?? [XX_TOUR, XX_SOLO]).map(authored))
	const fixture = createFixture('<concerts-route></concerts-route>', class {}, [
		ConsoleI18nConfiguration,
		...ConsoleFormatters,
		...ConsoleUi,
		ConcertsRoute,
		Registration.instance(ISeriesClient, { list }),
		Registration.instance(ITicketSaleClient, {
			// XX Tour's first date has a lottery open now; the others have no sale.
			listByEvent: vi.fn(async (eventId: string) =>
				eventId === 'e-1103' ? openLottery(eventId) : NO_SALES,
			),
		}),
		Registration.instance(IClock, { now: () => NOW }),
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
				.mockResolvedValue(artistsNamed(...(opts.artists ?? ['Band A']))),
		}),
	])
	await fixture.startPromise
	const host = fixture.appHost.querySelector('concerts-route') as HTMLElement
	const vm = CustomElement.for<ConcertsRoute>(host).viewModel
	const context = fixture.container.get(IConsoleContext)
	await context.load()
	context.follow({
		organizerId: 'org-1',
		artistId: opts.artist ?? 'a-1',
	})
	vm.loading({ artistId: opts.artist ?? 'a-1' })
	await vm.load()
	// The sale states are read after the list shows.
	if (vm.rows.length) {
		await vi.waitFor(() => expect(vm.rows[0].cells.sale).toBeDefined())
	}
	await tasksSettled()
	const items = () => deepAll(host, 'list-item')
	const table = () => host.querySelector('data-list') as HTMLElement
	return { fixture, host, vm, list, items, table }
}

describe('concerts of an Artist', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Phone"`, async () => {
		const { fixture, items } = await mount()

		expect(items()).toHaveLength(2)
		const [tour, solo] = items()
		// Each concert is one link: the whole item, with nothing else inside.
		expect(deepAll(tour, 'a')).toHaveLength(1)
		expect(deepAll(tour, 'button')).toHaveLength(0)
		expect(deepAll(tour, 'a')[0].getAttribute('href')).toMatch(
			/\/series\/s-tour$/,
		)
		// Title; first date · venue; sale state; the status at the trailing edge.
		expect(deepText(tour)).toMatch(
			/XX Tour 2026.*11月3日\(火\) 他 3公演 · Zepp Haneda 他.*受付中.*公開中/,
		)
		// No duplicate 開く: the item itself opens the concert.
		expect(controlNamed(tour, '開く')).toBeNull()
		expect(deepText(solo)).toContain('XX 単独公演')
		expect(deepText(solo)).toContain('12月20日(日)')
		expect(deepText(solo)).toContain('Zepp Haneda')
		expect(deepText(solo)).toContain('販売なし')
		expect(deepText(solo)).toContain('下書き')
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "PC"`, async () => {
		const { fixture, table } = await mount()

		expect(deepAll(table(), 'thead th').map((th) => deepText(th))).toEqual([
			'公演名',
			'日程・会場',
			'販売状態',
			'状態',
		])
		const rows = deepAll(table(), 'tbody tr')
		expect(rows).toHaveLength(2)
		expect(deepText(rows[0])).toContain('XX Tour 2026')
		expect(deepText(rows[0])).toContain('受付中')
		expect(deepText(rows[1])).toContain('XX 単独公演')
		expect(deepText(rows[1])).toContain('下書き')
		// One link per row, to the concert page.
		expect(deepAll(rows[0], 'a')).toHaveLength(1)
		expect(deepAll(rows[0], 'a')[0].getAttribute('href')).toMatch(
			/\/series\/s-tour$/,
		)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Tour summary"`, async () => {
		const { fixture, items } = await mount()
		expect(deepText(items()[0])).toContain(
			'11月3日(火) 他 3公演 · Zepp Haneda 他',
		)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Another Artist's concert"`, async () => {
		const concerts = [XX_TOUR, XX_SOLO, YY_LIVE]
		const bandA = await mount({ concerts, artists: ['Band A', 'Band B'] })
		expect(bandA.items()).toHaveLength(2)
		expect(deepText(bandA.host)).not.toContain('YY Live')
		await bandA.fixture.tearDown()

		const bandB = await mount({
			concerts,
			artists: ['Band A', 'Band B'],
			artist: 'a-2',
		})
		expect(bandB.items()).toHaveLength(1)
		expect(deepText(bandB.items()[0])).toContain('YY Live')
		await bandB.fixture.tearDown()
	})

	it(`@spec ${SPEC} "Create from an Artist"`, async () => {
		// Band B, the second Artist by name: the address names it, so the link
		// is not the default Artist's.
		const { fixture, host } = await mount({
			artists: ['Band A', 'Band B'],
			artist: 'a-2',
		})

		const create = deepAll(host, 'a').filter(
			(a) => deepText(a) === '公演をつくる',
		)
		expect(create.map((a) => a.getAttribute('href'))).toEqual([
			'/organizers/org-1/artists/a-2/series/new',
		])
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "First visit"`, async () => {
		const { fixture, host } = await mount({ concerts: [] })
		await tasksSettled()

		expect(deepText(host)).toContain('まだ公演がありません。')
		// The screen's one floating action opens the editor.
		const create = deepAll(host, 'a').filter(
			(a) => deepText(a) === '公演をつくる',
		)
		expect(create).toHaveLength(1)
		expect(create[0].getAttribute('href')).toMatch(/\/series\/new$/)
		expect(host.querySelector('extended-fab')).not.toBeNull()
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Load fails"`, async () => {
		const list = vi
			.fn()
			.mockRejectedValue(new ConnectError('backend down', Code.Unavailable))
		const { fixture, host } = await mount({ list })

		const alert = host.querySelector('[role="alert"]') as HTMLElement
		expect(deepText(alert)).toContain('公演を読み込めませんでした。')
		const reads = list.mock.calls.length
		controlNamed(alert, '再試行')?.click()
		await vi.waitFor(() =>
			expect(list.mock.calls.length).toBeGreaterThan(reads),
		)
		await fixture.tearDown()
	})
})
