import { IRouteContext, IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketStockSchema,
	TicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import ja from '../../../organizer/locales/ja/translation.json'
import { IClock } from '../../../organizer/services/clock'
import { IOrganizerClient } from '../../../organizer/services/organizer-client'
import { ISeriesClient } from '../../../organizer/services/series-client'
import {
	ITicketSaleClient,
	type TicketSale,
} from '../../../organizer/services/ticket-sale-client'
import {
	type EventTicketStocks,
	ITicketStockClient,
} from '../../../organizer/services/ticket-stock-client'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import {
	firstComeSaleOf,
	TicketSaleEditorRoute,
} from '../../../organizer/ticket-sale-editor/ticket-sale-editor-route'
import { ActionBar } from '../../../organizer/ui/action-bar/action-bar'
import { ConfirmDialog } from '../../../organizer/ui/confirm-dialog/confirm-dialog'
import { ConsoleButton } from '../../../organizer/ui/console-button/console-button'
import { ConsoleField } from '../../../organizer/ui/console-field/console-field'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { ISnackbar } from '../../../organizer/ui/console-snackbar/snackbar'
import { ConsoleTimeField } from '../../../organizer/ui/console-time-field/console-time-field'
import { PrerequisiteCallout } from '../../../organizer/ui/prerequisite-callout/prerequisite-callout'
import { StatTile } from '../../../organizer/ui/stat-tile/stat-tile'
import { StatusBadge } from '../../../organizer/ui/status-badge/status-badge'
import { UnsavedChanges } from '../../../organizer/ui/unsaved-changes/unsaved-changes'
import { authoredSeries } from '../authored-series'

const SPEC = 'components/infrastructure/organizer/web/global/error-messages'
const EDITOR_SPEC =
	'components/infrastructure/organizer/web/route/ticket-sale-editor'

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))
/** The message the server sent with the refusal. */
const SERVER_MESSAGE =
	'ticket sale window overlaps another sale (failed_precondition)'

type Route = InstanceType<typeof TicketSaleEditorRoute>

/** 2026-10-01 00:00 UTC: the clock of every test. */
const NOW = Date.UTC(2026, 9, 1)

function eventInit(
	init: Partial<{ publishState: PublishState; start: Date | null }> = {},
) {
	const start = init.start === undefined ? EVENT_START : init.start
	return {
		id: { value: 'e-1' },
		publishState: init.publishState ?? PublishState.PUBLISHED,
		localDate: { value: { year: 2026, month: 11, day: 20 } },
		...(start ? { startTime: { value: timestampFromDate(start) } } : {}),
	}
}

const COMPLETE_ORGANIZER = {
	legalName: { value: '株式会社XX' },
	representativeName: { value: '山田太郎' },
	businessAddress: { value: '東京都渋谷区1-2-3' },
	businessPhoneNumber: { value: '0312345678' },
	contactEmail: { value: 'owner@xx-records.example' },
}

/** A first-come sale naming event e-1 (or another event). */
function firstComeSale(init: {
	id: string
	name?: string
	start: Date
	end: Date
	eventId?: string
	method?: TicketSaleMethod
}): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: init.id },
		name: { value: init.name ?? '一般発売' },
		method: init.method ?? TicketSaleMethod.FIRST_COME,
		saleStartTime: timestampFromDate(init.start),
		saleEndTime: timestampFromDate(init.end),
		eventIds: [{ value: init.eventId ?? 'e-1' }],
	})
}

/** The event's stocks: S席 8,000円 × 300 and A席 6,000円 × 700. */
function twoStocks(): EventTicketStocks {
	return {
		ticketStocks: [
			{ id: 'st-s', seat: 'seat-s', quantity: 300 },
			{ id: 'st-a', seat: 'seat-a', quantity: 700 },
		].map((s) =>
			create(TicketStockSchema, {
				id: { value: s.id },
				eventId: { value: 'e-1' },
				seatTypeId: { value: s.seat },
				quantity: s.quantity,
				soldCount: 0,
				heldCount: 0,
				state: TicketStockState.AVAILABLE,
			}),
		),
		seatTypes: [
			{ id: 'seat-s', name: 'S席', price: 8000 },
			{ id: 'seat-a', name: 'A席', price: 6000 },
		].map((t) =>
			create(SeatTypeSchema, {
				id: { value: t.id },
				seriesId: { value: 's-1' },
				name: { value: t.name },
				price: { value: BigInt(t.price) },
			}),
		),
	}
}

interface Doubles {
	list: ReturnType<typeof vi.fn>
	getOrganizer: ReturnType<typeof vi.fn>
	listByEvent: ReturnType<typeof vi.fn>
	create: ReturnType<typeof vi.fn>
	setWindow: ReturnType<typeof vi.fn>
	listStocks: ReturnType<typeof vi.fn>
	load: ReturnType<typeof vi.fn>
	show: ReturnType<typeof vi.fn>
	showError: ReturnType<typeof vi.fn>
}

function doubles(over: Partial<Doubles> = {}): Doubles {
	const concert = authoredSeries({
		series: { id: { value: 's-1' }, title: { value: 'XX Tour' } },
		events: [eventInit()],
	})
	return {
		list: vi.fn().mockResolvedValue([concert]),
		getOrganizer: vi
			.fn()
			.mockResolvedValue(create(OrganizerSchema, COMPLETE_ORGANIZER)),
		listByEvent: vi.fn().mockResolvedValue({ ticketSales: [] }),
		create: vi.fn(),
		setWindow: vi.fn(),
		listStocks: vi.fn().mockResolvedValue(twoStocks()),
		load: vi.fn().mockResolvedValue(undefined),
		show: vi.fn(),
		showError: vi.fn(),
		...over,
	}
}

/** The concert list with event e-1 as given. */
function concertWith(event: ReturnType<typeof eventInit>) {
	return [
		authoredSeries({
			series: { id: { value: 's-1' }, title: { value: 'XX Tour' } },
			events: [event],
		}),
	]
}

function registrations(d: Doubles) {
	return [
		Registration.instance(ISeriesClient, { list: d.list }),
		Registration.instance(IOrganizerClient, { get: d.getOrganizer }),
		Registration.instance(ITicketSaleClient, {
			listByEvent: d.listByEvent,
			create: d.create,
			setWindow: d.setWindow,
		}),
		Registration.instance(ITicketStockClient, { listByEvent: d.listStocks }),
		Registration.instance(IRouter, { load: d.load }),
		Registration.instance(IRouteContext, {
			getRouteParameters: () => ({ seriesId: 's-1', eventId: 'e-1' }),
		}),
		Registration.instance(IBreadcrumbs, { set: vi.fn() }),
		Registration.instance(IConsoleContext, {
			scope: { organizer: 'org-1', artist: 'a-1' },
		}),
		Registration.instance(IClock, { now: () => NOW }),
		Registration.instance(ISnackbar, { show: d.show, showError: d.showError }),
	]
}

async function mount(
	over: Partial<Doubles> = {},
	settled: Route['state'] = 'ready',
) {
	const d = doubles(over)
	const fixture = createFixture(
		'<ticket-sale-editor-route></ticket-sale-editor-route>',
		class {},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			ActionBar,
			ConfirmDialog,
			ConsoleButton,
			ConsoleField,
			ConsoleIcon,
			ConsoleTimeField,
			PrerequisiteCallout,
			StatTile,
			StatusBadge,
			UnsavedChanges,
			TicketSaleEditorRoute,
			...registrations(d),
		],
	)
	await fixture.startPromise
	const host = fixture.appHost.querySelector('ticket-sale-editor-route')
	if (!host) throw new Error('ticket-sale-editor-route did not render')
	const vm = CustomElement.for<Route>(host).viewModel
	await vi.waitFor(() => expect(vm.state).toBe(settled))
	await tasksSettled()
	return { fixture, vm, host, d }
}

/** A form the validation accepts for event e-1. */
function validModel() {
	return {
		name: '一般発売',
		saleStart: { date: '2026-11-01', time: '12:00' },
		saleEnd: { date: '2026-11-20', time: '19:00' },
	}
}

const SALES_HREF =
	'/organizers/org-1/artists/a-1/series/s-1/events/e-1/ticket-sales'

describe('firstComeSaleOf', () => {
	const day = (d: number) => new Date(Date.UTC(2026, 9, d))

	it('prefers the open sale, then the next one, then the most recent', () => {
		const past = firstComeSale({ id: 'past', start: day(1), end: day(2) })
		const older = firstComeSale({ id: 'older', start: day(1), end: day(1) })
		const open = firstComeSale({ id: 'open', start: day(3), end: day(6) })
		const later = firstComeSale({ id: 'later', start: day(9), end: day(10) })
		const next = firstComeSale({ id: 'next', start: day(7), end: day(8) })
		const now = day(4).getTime()

		expect(firstComeSaleOf([past, next, open, later], 'e-1', now)).toBe(open)
		expect(firstComeSaleOf([past, later, next], 'e-1', now)).toBe(next)
		expect(firstComeSaleOf([older, past], 'e-1', now)).toBe(past)
	})

	it('ignores lottery sales, sales of other events and sales without a window', () => {
		const lottery = firstComeSale({
			id: 'lottery',
			start: day(3),
			end: day(6),
			method: TicketSaleMethod.LOTTERY,
		})
		const other = firstComeSale({
			id: 'other',
			start: day(3),
			end: day(6),
			eventId: 'e-2',
		})
		const unwindowed = create(TicketSaleSchema, {
			id: { value: 'nowindow' },
			method: TicketSaleMethod.FIRST_COME,
			eventIds: [{ value: 'e-1' }],
		})

		expect(
			firstComeSaleOf([lottery, other, unwindowed], 'e-1', day(4).getTime()),
		).toBeUndefined()
	})
})

describe('first-come sale editor', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Refused first-come sale save"`, async () => {
		const err = new ConnectError(SERVER_MESSAGE, Code.FailedPrecondition)
		const createSale = vi.fn().mockRejectedValue(err)
		const { fixture, vm, host } = await mount({ create: createSale })
		const warn = vi.spyOn(vm['logger'], 'warn')

		vm.model = validModel()
		await vm.save()
		await tasksSettled()

		expect(createSale).toHaveBeenCalledTimes(1)
		const problem = host.querySelector('.problem')
		const text = problem?.textContent?.trim() ?? ''
		expect(
			ja.firstComeEditor.rejected.startsWith('保存できませんでした。'),
		).toBe(true)
		expect(text).toBe(ja.firstComeEditor.rejected)
		expect(text).toContain('ほかの販売と期間が重ならないか')
		expect(document.body.textContent).not.toContain(SERVER_MESSAGE)
		expect(document.body.textContent).not.toContain('overlaps another sale')
		expect(warn).toHaveBeenCalledWith('First-come sale not saved', err)
		await fixture.tearDown()
	})

	it.each([
		[
			'a cancelled event',
			{
				list: vi
					.fn()
					.mockResolvedValue(
						concertWith(eventInit({ publishState: PublishState.CANCELLED })),
					),
			},
			['cancelled'],
			ja.event.cancelledNote,
		],
		[
			'a draft event',
			{
				list: vi
					.fn()
					.mockResolvedValue(
						concertWith(eventInit({ publishState: PublishState.DRAFT })),
					),
			},
			['notPublished'],
			ja.sale.prerequisite.notPublished,
		],
		[
			'an event without a start time',
			{
				list: vi
					.fn()
					.mockResolvedValue(concertWith(eventInit({ start: null }))),
			},
			['noStartTime'],
			ja.sale.prerequisite.noStartTime,
		],
		[
			'an event without a TicketStock',
			{
				listStocks: vi
					.fn()
					.mockResolvedValue({ ticketStocks: [], seatTypes: [] }),
			},
			['noStock'],
			ja.sale.prerequisite.noStock,
		],
		[
			'an Organizer without business details',
			{
				getOrganizer: vi.fn().mockResolvedValue(
					create(OrganizerSchema, {
						...COMPLETE_ORGANIZER,
						legalName: { value: ' ' },
					}),
				),
			},
			['businessDetails'],
			ja.sale.prerequisite.businessDetails,
		],
	])(
		'blocks the sale of %s and shows why instead of the form',
		async (_, over, blocks, heading) => {
			const { fixture, vm, host, d } = await mount(over)

			expect(vm.blocks).toEqual(blocks)
			const callout = host.querySelector('prerequisite-callout')
			expect(
				callout?.shadowRoot?.textContent ?? callout?.textContent,
			).toContain(heading)
			expect(host.querySelector('form')).toBeNull()
			expect(vm.isDirty).toBe(false)

			await vm.save()
			expect(d.create).not.toHaveBeenCalled()
			expect(vm.submitted).toBe(false)
			await fixture.tearDown()
		},
	)

	it(`@spec ${EDITOR_SPEC} "No seat type stocked"`, async () => {
		const { fixture, host } = await mount({
			listStocks: vi
				.fn()
				.mockResolvedValue({ ticketStocks: [], seatTypes: [] }),
		})
		const callout = host.querySelector('prerequisite-callout')
		const links = [...(callout?.shadowRoot?.querySelectorAll('a') ?? [])].map(
			(a) => a.getAttribute('href'),
		)
		expect(links).toEqual([SALES_HREF, '/guide.html#sell'])
		expect(host.textContent).toContain(ja.saleEditor.noStockBody)
		expect(host.querySelector('action-bar')).toBeNull()
		await fixture.tearDown()
	})

	it('blocks the sale of an Organizer that could not be read', async () => {
		const { fixture, vm } = await mount({
			getOrganizer: vi.fn().mockResolvedValue(undefined),
		})
		expect(vm.blocks).toEqual(['businessDetails'])
		await fixture.tearDown()
	})

	it('says the event was not found when the concert has no such event', async () => {
		const { fixture, vm, host } = await mount(
			{ list: vi.fn().mockResolvedValue([]) },
			'notFound',
		)
		expect(host.textContent).toContain(ja.event.notFound)
		expect(vm.event).toBeUndefined()
		expect(vm.start).toBeUndefined()
		expect(vm.venue).toBe('')
		await fixture.tearDown()
	})

	it('says the sale could not be read when loading fails, without the server message', async () => {
		const failure = new ConnectError('down', Code.Unavailable)
		const { fixture, host } = await mount(
			{ listByEvent: vi.fn().mockRejectedValue(failure) },
			'error',
		)
		expect(host.textContent).toContain(ja.firstComeEditor.loadFailed)
		expect(host.textContent).not.toContain('down')
		await fixture.tearDown()
	})

	it(`@spec ${EDITOR_SPEC} "Blank form"`, async () => {
		const { fixture, vm, host } = await mount()

		expect(vm.sale).toBeUndefined()
		expect(vm.model.name).toBe(ja.firstComeEditor.defaultName)
		expect(vm.model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
		const stocks = [...host.querySelectorAll('.stock')].map((li) =>
			li.textContent?.replace(/\s+/g, ' ').trim(),
		)
		expect(stocks).toEqual([
			'S席 8,000円 税込 · 300枚',
			'A席 6,000円 税込 · 700枚',
		])
		expect(host.textContent).toContain('1アカウント4枚まで')
		// No price, quantity or limit to enter.
		expect(host.querySelectorAll('console-field')).toHaveLength(3)
		expect(vm.isDirty).toBe(false)
		await expect(vm.canUnload()).resolves.toBe(true)
		await fixture.tearDown()
	})

	it('shows field errors only after a save is tried, and sends nothing while invalid', async () => {
		const { fixture, vm, d } = await mount()

		expect(vm.error(vm.errors.saleStartDate)).toBeNull()
		await vm.save()

		expect(d.create).not.toHaveBeenCalled()
		expect(vm.submitted).toBe(true)
		expect(vm.error(vm.errors.saleStartDate)?.key).toBe(
			'firstComeEditor.error.start',
		)
		expect(vm.error(undefined)).toBeNull()
		await fixture.tearDown()
	})

	it('refuses a window that overlaps another sale and names it in Japan time', async () => {
		const other = firstComeSale({
			id: 'other',
			name: '先行販売',
			start: new Date('2026-10-31T03:00:00Z'),
			end: new Date('2026-11-05T03:00:00Z'),
			eventId: 'e-9',
			method: TicketSaleMethod.LOTTERY,
		})
		const { fixture, vm, d } = await mount({
			listByEvent: vi.fn().mockResolvedValue({ ticketSales: [other] }),
		})
		vm.model = validModel()

		await vm.save()

		expect(d.create).not.toHaveBeenCalled()
		expect(vm.error(vm.errors.saleStartDate)).toEqual({
			key: 'firstComeEditor.error.overlap',
			params: {
				name: '先行販売',
				start: '2026-10-31 12:00',
				end: '2026-11-05 12:00',
			},
		})
		await fixture.tearDown()
	})

	it('creates the sale, says so and returns to the Sales tab', async () => {
		const created = firstComeSale({
			id: 'new',
			start: new Date('2026-11-01T03:00:00Z'),
			end: EVENT_START,
		})
		const { fixture, vm, d } = await mount({
			create: vi.fn().mockResolvedValue(created),
		})
		vm.model = validModel()
		expect(vm.isDirty).toBe(true)

		await vm.save()

		expect(d.create).toHaveBeenCalledWith(
			{
				seriesId: 's-1',
				name: '一般発売',
				method: 'firstCome',
				saleStartTime: new Date('2026-11-01T03:00:00Z'),
				saleEndTime: EVENT_START,
				eventIds: ['e-1'],
			},
			expect.any(AbortSignal),
		)
		expect(vm.sale).toBe(created)
		expect(vm.isDirty).toBe(false)
		expect(d.show).toHaveBeenCalledWith('firstComeEditor.saved')
		expect(d.load).toHaveBeenCalledWith(SALES_HREF)
		await fixture.tearDown()
	})

	it('offers Retry when a save fails for another reason', async () => {
		const failure = new ConnectError('unavailable', Code.Unavailable)
		const { fixture, vm, host, d } = await mount({
			create: vi.fn().mockRejectedValue(failure),
		})
		vm.model = validModel()

		await vm.save()
		await tasksSettled()

		expect(vm.saveProblem).toBe('')
		expect(host.querySelector('.problem')).toBeNull()
		expect(d.showError).toHaveBeenCalledWith('firstComeEditor.saveFailed', {
			retry: expect.any(Function),
		})
		expect(ja.firstComeEditor.saveFailed).toBe('保存できませんでした')

		d.showError.mock.calls[0][1].retry()
		await vi.waitFor(() => expect(d.create).toHaveBeenCalledTimes(2))
		await fixture.tearDown()
	})

	describe('an existing sale', () => {
		const stored = (over: Partial<Parameters<typeof firstComeSale>[0]> = {}) =>
			firstComeSale({
				id: 'fc-1',
				start: new Date('2026-09-20T03:00:00Z'),
				end: EVENT_START,
				...over,
			})

		it(`@spec ${EDITOR_SPEC} "Nothing else to edit"`, async () => {
			const { fixture, vm, host } = await mount({
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [stored()] }),
			})

			expect(vm.model).toEqual({
				name: '一般発売',
				saleStart: { date: '2026-09-20', time: '12:00' },
				saleEnd: { date: '2026-11-20', time: '19:00' },
			})
			expect(host.textContent).toContain(ja.firstComeEditor.changeTitle)
			// The name is shown, not edited; only the window's dates are fields.
			expect(host.querySelector('.fixed')?.textContent).toContain('一般発売')
			const labels = [...host.querySelectorAll('console-field')].map(
				(f) => CustomElement.for<ConsoleField>(f).viewModel.label,
			)
			expect(labels).toEqual([
				ja.firstComeEditor.startDate,
				ja.firstComeEditor.endDate,
			])
			await fixture.tearDown()
		})

		it(`@spec ${EDITOR_SPEC} "Sale extended"`, async () => {
			const moved = stored({ start: new Date('2026-09-25T03:00:00Z') })
			const { fixture, vm, d } = await mount({
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [stored()] }),
				setWindow: vi.fn().mockResolvedValue(moved),
			})
			vm.model.saleStart = { date: '2026-09-25', time: '12:00' }

			await vm.save()

			expect(d.setWindow).toHaveBeenCalledWith(
				'fc-1',
				new Date('2026-09-25T03:00:00Z'),
				EVENT_START,
				expect.any(AbortSignal),
			)
			expect(d.create).not.toHaveBeenCalled()
			expect(vm.sale).toBe(moved)
			expect(d.show).toHaveBeenCalledWith('firstComeEditor.saved')
			expect(d.load).toHaveBeenCalledWith(SALES_HREF)
			await fixture.tearDown()
		})

		it('sends nothing when the window did not change', async () => {
			const { fixture, vm, d } = await mount({
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [stored()] }),
			})

			await vm.save()

			expect(d.setWindow).not.toHaveBeenCalled()
			expect(d.load).toHaveBeenCalledWith(SALES_HREF)
			await fixture.tearDown()
		})

		it('says why a refused window change was not saved', async () => {
			const { fixture, vm, d } = await mount({
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [stored()] }),
				setWindow: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('overlap', Code.FailedPrecondition),
					),
			})
			vm.model.saleStart = { date: '2026-09-25', time: '12:00' }

			await vm.save()

			expect(vm.saveProblem).toBe('firstComeEditor.rejected')
			expect(d.showError).not.toHaveBeenCalled()
			expect(d.load).not.toHaveBeenCalled()
			await fixture.tearDown()
		})
	})
})
