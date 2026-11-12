import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import { TicketStockSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcertRoute } from '../../../organizer/concert/concert-route'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IArtistClient } from '../../../organizer/services/artist-client'
import { IClock } from '../../../organizer/services/clock'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeatTypeClient } from '../../../organizer/services/seat-type-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import { ITicketSaleClient } from '../../../organizer/services/ticket-sale-client'
import { ITicketStockClient } from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleUi } from '../../../organizer/ui'
import {
	allDates,
	artistsNamed,
	authored,
	type ConcertSpec,
	NO_SALES,
	openLottery,
	XX_TOUR,
} from '../concert-fixtures'
import {
	controlNamed,
	deepAll,
	deepOne,
	deepText,
	fillField,
	installDialogAndPopover,
	openDialogs,
} from '../console-dom'

/**
 * One concert as the member reads it: the real route template and console
 * components, with the clients faked. `ConcertRoute` is built apart in
 * `concert-route.spec.ts` to check one failure; here the page is rendered.
 * The summary's place beside or below the dates is CSS jsdom does not
 * compute, so it is checked in `e2e/functional/organizer-concert.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert'

/** 2026-10-28 10:00 JST. */
const NOW = new Date('2026-10-28T10:00:00+09:00').getTime()

/** XX Tour 2026 with three dates, listed by the server out of date order. */
const TOUR_OF_THREE: ConcertSpec = {
	...XX_TOUR,
	events: [XX_TOUR.events[2], XX_TOUR.events[0], XX_TOUR.events[1]],
}

const DRAFT_TOUR = allDates(XX_TOUR, 'DRAFT')

interface SeatTypeSpec {
	id: string
	name: string
	price: number
}

const SEAT_S: SeatTypeSpec = { id: 'seat-s', name: 'S席', price: 12000 }

function seatTypeOf(t: SeatTypeSpec) {
	return create(SeatTypeSchema, {
		id: { value: t.id },
		seriesId: { value: 's-tour' },
		name: { value: t.name },
		price: { value: BigInt(t.price) },
	})
}

interface Options {
	concert?: ConcertSpec
	seatTypes?: SeatTypeSpec[]
	/** The seat types each date (by event id) holds tickets of. */
	stocked?: Record<string, SeatTypeSpec[]>
	artist?: string
	path?: string
	seriesId?: string
}

/**
 * A small concert server in memory: Publish publishes the named DRAFT dates
 * and Cancel cancels every date, Create and Delete change the seat types, so
 * the page reads back what the action did.
 */
async function mount(opts: Options = {}) {
	const state: ConcertSpec = structuredClone(opts.concert ?? TOUR_OF_THREE)
	const seatTypes = [...(opts.seatTypes ?? [])]
	const list = vi.fn(async () => [authored(state)])
	const publish = vi.fn(async (_series: string, ids: string[]) => {
		for (const e of state.events) {
			if (e.state === 'DRAFT' && (ids.length === 0 || ids.includes(e.id))) {
				e.state = 'PUBLISHED'
			}
		}
		return authored(state)
	})
	const cancel = vi.fn(async () => {
		state.events = state.events
			.filter((e) => e.state !== 'DRAFT')
			.map((e) => ({ ...e, state: 'CANCELLED' as const }))
	})
	const createSeatType = vi.fn(
		async (input: { seriesId: string; name: string; price: number }) => {
			if (seatTypes.some((t) => t.name === input.name)) {
				throw new ConnectError('seat type name taken', Code.AlreadyExists)
			}
			const t = {
				id: `seat-${seatTypes.length + 1}`,
				name: input.name,
				price: input.price,
			}
			seatTypes.push(t)
			return seatTypeOf(t)
		},
	)
	const deleteSeatType = vi.fn(async (id: string) => {
		const stocked = Object.values(opts.stocked ?? {})
			.flat()
			.some((t) => t.id === id)
		if (stocked) throw new ConnectError('in use', Code.FailedPrecondition)
		seatTypes.splice(
			seatTypes.findIndex((t) => t.id === id),
			1,
		)
	})
	const load = vi.fn()
	const fixture = createFixture(
		'<console-snackbar></console-snackbar><concert-route></concert-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			...ConsoleUi,
			ConcertRoute,
			Registration.instance(ISeriesClient, { list, publish, cancel }),
			Registration.instance(ITicketSaleClient, {
				listByEvent: vi.fn(async (eventId: string) =>
					eventId === 'e-1103' ? openLottery(eventId) : NO_SALES,
				),
			}),
			Registration.instance(ISeatTypeClient, {
				listBySeries: vi.fn(async () => seatTypes.map(seatTypeOf)),
				create: createSeatType,
				delete: deleteSeatType,
			}),
			Registration.instance(ITicketStockClient, {
				listByEvent: vi.fn(async (eventId: string) => ({
					ticketStocks: (opts.stocked?.[eventId] ?? []).map((t) =>
						create(TicketStockSchema, {
							id: { value: `stock-${t.id}` },
							eventId: { value: eventId },
							seatTypeId: { value: t.id },
							quantity: 300,
						}),
					),
					seatTypes: [],
				})),
			}),
			Registration.instance(IClock, { now: () => NOW }),
			Registration.instance(IRouter, { load }),
			Registration.instance(IBreadcrumbs, { set: vi.fn() }),
			Registration.instance(IOrganizerClient, {
				get: vi
					.fn()
					.mockResolvedValue(
						create(OrganizerSchema, { id: { value: 'org-1' } }),
					),
			}),
			Registration.instance(IArtistClient, {
				list: vi.fn().mockResolvedValue(artistsNamed('Band A', 'Band B')),
			}),
		],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector('concert-route') as HTMLElement
	const vm = CustomElement.for<ConcertRoute>(host).viewModel
	const context = fixture.container.get(IConsoleContext)
	await context.load()
	context.follow({ organizerId: 'org-1', artistId: opts.artist ?? 'a-1' })
	vm.loading({ seriesId: opts.seriesId ?? 's-tour' })
	await vm.load()
	await tasksSettled()
	await vi.waitFor(() =>
		expect(vm.rows.length === 0 || vm.rows[0].cells.sale).toBeTruthy(),
	)
	await tasksSettled()
	/** The dates as list items (the table form holds the same rows). */
	const dates = () =>
		deepAll(host.querySelector('data-list') as Element, 'ul.list > li')
	/** The publish state at the trailing edge of each date. */
	const badges = () =>
		deepAll(host.querySelector('data-list') as Element, 'ul.list > li').map(
			(li) => deepText(deepOne(li, 'status-badge') as Element),
		)
	const section = () =>
		host.querySelector('[data-testid="seat-types"]') as HTMLElement
	const header = () => host.querySelector('header') as HTMLElement
	return {
		fixture,
		host,
		vm,
		list,
		publish,
		cancel,
		createSeatType,
		deleteSeatType,
		load,
		dates,
		badges,
		section,
		header,
	}
}

type Mounted = Awaited<ReturnType<typeof mount>>

/** Presses the control in the root and waits for what it starts. */
async function press(root: ParentNode, name: string): Promise<void> {
	const control = controlNamed(root, name)
	if (!control) throw new Error(`no control named ${name}`)
	control.click()
	await tasksSettled()
}

/** The only dialog open now, as its `confirm-dialog` element (its body is slotted into it). */
function theDialog(host: ParentNode): HTMLElement {
	const open = openDialogs(host)
	expect(open).toHaveLength(1)
	return (open[0].getRootNode() as ShadowRoot).host as HTMLElement
}

/** Confirms the open dialog with its confirming button. */
async function confirm(host: ParentNode): Promise<void> {
	deepOne(theDialog(host), '[data-role="confirm"]')?.click()
	await tasksSettled()
}

const snacks = (m: Mounted) =>
	deepAll(m.fixture.appHost, '.snack-message').map((el) => deepText(el))

describe('concert page', () => {
	let restore: () => void
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
		restore = installDialogAndPopover()
	})
	afterEach(() => {
		restore()
		vi.restoreAllMocks()
	})

	describe('summary and event dates', () => {
		it(`@spec ${SPEC} "Tour with three dates"`, async () => {
			const m = await mount()

			expect(m.host.querySelector('h1')?.textContent?.trim()).toBe(
				'XX Tour 2026',
			)
			// The dates in date order, each one item that is one link.
			const dates = m.dates()
			expect(dates).toHaveLength(3)
			const expected = [
				['11月3日(火) 18:00 JST', 'Zepp Haneda', '受付中', '公開中'],
				['11月10日(火) 18:00 JST', 'Zepp Osaka Bayside', '販売なし', '公開中'],
				['11月17日(火) 18:00 JST', 'Zepp Nagoya', '公開中'],
			]
			dates.forEach((date, i) => {
				for (const text of expected[i]) expect(deepText(date)).toContain(text)
				expect(deepAll(date, 'a')).toHaveLength(1)
				expect(deepAll(date, 'button')).toHaveLength(0)
			})
			expect(deepAll(dates[0], 'a')[0].getAttribute('href')).toBe(
				'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/ticket-sales',
			)
			// The summary names the type and the performers.
			const summary = m.host.querySelector('aside') as HTMLElement
			expect(summary.getAttribute('aria-labelledby')).toBe(
				'concert-summary-heading',
			)
			expect(deepText(summary)).toContain('ツアー')
			expect(deepText(summary)).toContain('Band A')
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Unknown concert"`, async () => {
			const m = await mount({ seriesId: 's-other' })

			expect(m.host.querySelector('h1')?.textContent?.trim()).toBe(
				'公演が見つかりません',
			)
			const back = controlNamed(m.host, '公演一覧へ')
			expect(back?.getAttribute('href')).toMatch(/\/series$/)
			await m.fixture.tearDown()
		})

		it(`@spec components/infrastructure/organizer/web/route/concerts "Another Artist's concert"`, async () => {
			// Under Band B the concert of Band A is not found, though the
			// Organizer has it.
			const m = await mount({ artist: 'a-2' })

			expect(m.host.querySelector('h1')?.textContent?.trim()).toBe(
				'公演が見つかりません',
			)
			await m.fixture.tearDown()
		})
	})

	describe('publish or cancel the dates together', () => {
		it(`@spec ${SPEC} "New tour published at once"`, async () => {
			const m = await mount({ concert: DRAFT_TOUR })
			await press(m.header(), '公開する')

			const dialog = theDialog(m.host)
			const boxes = deepAll<HTMLInputElement>(dialog, 'input[type="checkbox"]')
			expect(boxes).toHaveLength(4)
			expect(boxes.every((b) => b.checked)).toBe(true)
			expect(deepText(dialog)).toContain('出演者のフォロワーに1回通知します')
			expect(deepText(dialog)).toContain(
				'XX Tour 2026 の公演日を公開しますか？',
			)
			await confirm(m.host)

			expect(m.publish).toHaveBeenCalledTimes(1)
			expect(m.publish).toHaveBeenCalledWith('s-tour', [
				'e-1103',
				'e-1110',
				'e-1117',
				'e-1124',
			])
			expect(m.badges()).toEqual(['公開中', '公開中', '公開中', '公開中'])
			expect(snacks(m)).toContain('4件の公演日を公開しました')
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Additional date on a published tour"`, async () => {
			const m = await mount({
				concert: {
					...XX_TOUR,
					events: XX_TOUR.events.map((e, i) =>
						i === 3 ? { ...e, state: 'DRAFT' as const } : e,
					),
				},
			})
			await press(m.header(), '公開する')

			expect(
				deepAll<HTMLInputElement>(theDialog(m.host), 'input[type="checkbox"]'),
			).toHaveLength(1)
			await confirm(m.host)

			expect(m.publish).toHaveBeenCalledWith('s-tour', ['e-1124'])
			expect(m.badges()).toEqual(['公開中', '公開中', '公開中', '公開中'])
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "One date left out"`, async () => {
			const m = await mount({ concert: DRAFT_TOUR })
			await press(m.header(), '公開する')

			const left = deepAll<HTMLInputElement>(
				theDialog(m.host),
				'input[type="checkbox"]',
			).find((b) =>
				deepText(b.closest('label') as Element).includes('11月24日'),
			)
			if (!left) throw new Error('no checkbox for 11月24日')
			left.checked = false
			left.dispatchEvent(new Event('change', { bubbles: true }))
			await tasksSettled()
			await confirm(m.host)

			expect(m.publish).toHaveBeenCalledWith('s-tour', [
				'e-1103',
				'e-1110',
				'e-1117',
			])
			expect(m.badges()).toEqual(['公開中', '公開中', '公開中', '下書き'])
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Whole concert cancelled"`, async () => {
			const m = await mount({ concert: XX_TOUR })

			// Out of the header's row of buttons: in its overflow menu.
			const outside = deepAll(m.header(), 'button').filter(
				(b) =>
					deepText(b) === '公演を中止' && b.getAttribute('role') !== 'menuitem',
			)
			expect(outside).toHaveLength(0)
			const menu = m.header().querySelector('overflow-menu') as HTMLElement
			await press(menu, '公演を中止')
			const dialog = theDialog(m.host)
			expect(deepText(dialog)).toContain('XX Tour 2026 を中止しますか？')
			expect(deepText(dialog)).toContain('ファンに1回知らされます')
			await confirm(m.host)

			expect(m.cancel).toHaveBeenCalledTimes(1)
			// The whole concert: no event ids.
			expect(m.cancel.mock.calls[0]).toEqual(['s-tour'])
			expect(m.badges()).toEqual(['中止', '中止', '中止', '中止'])
			// Nothing left to cancel: the item stays in the menu, disabled.
			expect(
				controlNamed(menu, '公演を中止')?.getAttribute('aria-disabled'),
			).toBe('true')
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Nothing to publish"`, async () => {
			const m = await mount({ concert: XX_TOUR })

			expect(m.host.querySelector('h1')?.textContent?.trim()).toBe(
				'XX Tour 2026',
			)
			expect(controlNamed(m.header(), '公開する')).toBeNull()
			await m.fixture.tearDown()
		})

		it('makes 公開する the one filled action, 編集 outlined, and puts cancel in the menu', async () => {
			const m = await mount({ concert: DRAFT_TOUR })

			const variant = (name: string) =>
				deepAll(m.header(), `[data-variant="${name}"]`).map((el) =>
					deepText(el),
				)
			expect(variant('filled')).toEqual(['公開する'])
			expect(variant('outlined')).toEqual(['編集'])
			expect(controlNamed(m.header(), '編集')?.getAttribute('href')).toBe(
				'/organizers/org-1/artists/a-1/series/s-tour/edit',
			)
			const menu = m.header().querySelector('overflow-menu') as HTMLElement
			expect(
				deepAll(menu, '[role="menuitem"]').map((el) => deepText(el)),
			).toEqual(['公演を中止'])
			await m.fixture.tearDown()
		})
	})

	describe("the concert's seat types", () => {
		const names = (m: Mounted) =>
			deepAll(m.section(), '.seat-type-name').map((el) => deepText(el))
		const item = (m: Mounted, name: string) =>
			deepAll(m.section(), '.seat-type').find((el) =>
				deepText(el).includes(name),
			)

		async function add(m: Mounted, name: string, price: string) {
			fillField(m.section(), /席種名/, name)
			fillField(m.section(), /価格/, price)
			await press(m.section(), '席種を追加')
		}

		it(`@spec ${SPEC} "Dome tour seat types"`, async () => {
			const m = await mount()
			expect(deepText(deepOne(m.section(), 'h2') as Element)).toBe('席種')

			for (const [name, price] of [
				['S席', '12000'],
				['A席', '9000'],
				['B席', '7000'],
			]) {
				await add(m, name, price)
				const dialog = theDialog(m.host)
				expect(deepText(dialog)).toContain(
					'席種名と価格はあとから変えられません',
				)
				await confirm(m.host)
				await vi.waitFor(() => expect(names(m)).toContain(name))
			}

			expect(names(m)).toEqual(['S席', 'A席', 'B席'])
			expect(deepText(item(m, 'S席') as Element)).toContain('12,000円')
			expect(deepText(item(m, 'A席') as Element)).toContain('9,000円')
			expect(deepText(item(m, 'B席') as Element)).toContain('7,000円')
			expect(deepText(m.section())).toContain(
				'枚数は公演日ごとに、公演日の販売タブで決めます。',
			)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Price mistake before stocking"`, async () => {
			const m = await mount({
				seatTypes: [{ id: 'seat-s', name: 'S席', price: 1200 }],
			})

			expect(deepText(item(m, 'S席') as Element)).toContain('1,200円')
			await press(item(m, 'S席') as Element, '削除')
			expect(deepText(theDialog(m.host))).toContain('S席を削除しますか？')
			await confirm(m.host)
			await vi.waitFor(() => expect(item(m, 'S席')).toBeUndefined())

			await add(m, 'S席', '12000')
			await confirm(m.host)
			await vi.waitFor(() => expect(item(m, 'S席')).toBeDefined())
			expect(deepText(item(m, 'S席') as Element)).toContain('12,000円')
			expect(m.deleteSeatType).toHaveBeenCalledWith('seat-s', expect.anything())
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Seat type in use"`, async () => {
			const m = await mount({
				seatTypes: [SEAT_S],
				stocked: { 'e-1103': [SEAT_S] },
			})

			const s = item(m, 'S席') as Element
			expect(deepText(s)).toContain('公演日に枚数があるため削除できません')
			expect(deepAll(s, 'button')).toHaveLength(0)
			expect(deepAll(s, 'input, textarea')).toHaveLength(0)
			await m.fixture.tearDown()
		})

		it(`@spec ${SPEC} "Name already used"`, async () => {
			const m = await mount({ seatTypes: [SEAT_S] })
			expect(item(m, 'S席')).toBeDefined()

			await add(m, 'S席', '9000')

			// The page tells the name is used; nothing was asked or created.
			expect(m.createSeatType).not.toHaveBeenCalled()
			expect(openDialogs(m.host)).toHaveLength(0)
			expect(
				deepText(
					m.section().querySelector('[data-field="seat-type-name"]') as Element,
				),
			).toContain('「S席」はこの公演の別の席種で使われています')
			await m.fixture.tearDown()
		})

		it('offers neither action once every date is cancelled', async () => {
			const m = await mount({
				seatTypes: [SEAT_S],
				concert: allDates(XX_TOUR, 'CANCELLED'),
			})

			expect(item(m, 'S席')).toBeDefined()
			expect(deepAll(m.section(), 'button')).toHaveLength(0)
			expect(deepAll(m.section(), 'console-field')).toHaveLength(0)
			await m.fixture.tearDown()
		})
	})
})
