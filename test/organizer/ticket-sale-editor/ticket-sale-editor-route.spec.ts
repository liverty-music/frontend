import { IRouteContext, IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { TicketTypeState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
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
import { ITicketTypeClient } from '../../../organizer/services/ticket-type-client'
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

/** A first-come sale of event e-1 (or another event) with one TicketType. */
function firstComeSale(init: {
	id: string
	name?: string
	start: Date
	end: Date
	eventId?: string
	method?: TicketSaleMethod
	sold?: number
	held?: number
	price?: number
	quantity?: number
	state?: TicketTypeState
}): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: init.id },
		name: { value: init.name ?? '一般発売' },
		method: init.method ?? TicketSaleMethod.FIRST_COME,
		saleStartTime: timestampFromDate(init.start),
		saleEndTime: timestampFromDate(init.end),
		ticketTypes: [
			{
				id: { value: `tt-${init.id}` },
				eventId: { value: init.eventId ?? 'e-1' },
				price: { value: BigInt(init.price ?? 3000) },
				quantity: init.quantity ?? 150,
				perAccountLimit: 4,
				soldCount: init.sold ?? 0,
				heldCount: init.held ?? 0,
				state: init.state ?? TicketTypeState.ON_SALE,
			},
		],
	})
}

interface Doubles {
	list: ReturnType<typeof vi.fn>
	getOrganizer: ReturnType<typeof vi.fn>
	listByEvent: ReturnType<typeof vi.fn>
	create: ReturnType<typeof vi.fn>
	setWindow: ReturnType<typeof vi.fn>
	update: ReturnType<typeof vi.fn>
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
		update: vi.fn(),
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
		Registration.instance(ITicketTypeClient, { update: d.update }),
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
		price: '3000',
		quantity: '150',
		perAccountLimit: '4',
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
			ticketTypes: [{ eventId: { value: 'e-1' } }],
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

	it('starts a new sale named by the console that ends at the event start', async () => {
		const { fixture, vm } = await mount()

		expect(vm.sale).toBeUndefined()
		expect(vm.model.name).toBe(ja.firstComeEditor.defaultName)
		expect(vm.model.saleEnd).toEqual({ date: '2026-11-20', time: '19:00' })
		expect(vm.model.perAccountLimit).toBe('4')
		expect(vm.stateKey).toBe('')
		expect(vm.priceHintKey).toBe('')
		expect(vm.isDirty).toBe(false)
		await expect(vm.canUnload()).resolves.toBe(true)
		await fixture.tearDown()
	})

	it('shows field errors only after a save is tried, and sends nothing while invalid', async () => {
		const { fixture, vm, d } = await mount()

		expect(vm.error(vm.errors.price)).toBeNull()
		await vm.save()

		expect(d.create).not.toHaveBeenCalled()
		expect(vm.submitted).toBe(true)
		expect(vm.error(vm.errors.price)?.key).toBe('firstComeEditor.error.price')
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
			expect.objectContaining({
				seriesId: 's-1',
				eventId: 'e-1',
				method: 'firstCome',
				price: 3000,
				quantity: 150,
				perAccountLimit: 4,
			}),
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

		it('shows the stored values, state and counts', async () => {
			const { fixture, vm, host } = await mount({
				listByEvent: vi.fn().mockResolvedValue({
					ticketSales: [stored({ sold: 12, held: 3 })],
				}),
			})

			expect(vm.model).toEqual({
				name: '一般発売',
				saleStart: { date: '2026-09-20', time: '12:00' },
				saleEnd: { date: '2026-11-20', time: '19:00' },
				price: '3000',
				quantity: '150',
				perAccountLimit: '4',
			})
			expect(vm.stateKey).toBe('sale.firstComeState.onSale')
			expect(host.textContent).toContain(ja.firstComeEditor.changeTitle)
			expect([vm.soldCount, vm.heldCount, vm.quantity]).toEqual([12, 3, 150])
			expect(vm.priceLocked).toBe(true)
			expect(vm.priceHintKey).toBe('firstComeEditor.priceLocked')
			await fixture.tearDown()
		})

		it('saves a changed window without touching the ticket type', async () => {
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
			expect(d.update).not.toHaveBeenCalled()
			expect(vm.sale).toBe(moved)
			expect(d.show).toHaveBeenCalledWith('firstComeEditor.saved')
			await fixture.tearDown()
		})

		it('saves a changed quantity on the ticket type without touching the window', async () => {
			const sale = stored()
			const changed = { ...sale.ticketTypes[0], quantity: 200 }
			const { fixture, vm, d } = await mount({
				listByEvent: vi.fn().mockResolvedValue({ ticketSales: [sale] }),
				update: vi.fn().mockResolvedValue(changed),
			})
			vm.model.quantity = ' 200 '

			await vm.save()

			expect(d.setWindow).not.toHaveBeenCalled()
			expect(d.update).toHaveBeenCalledWith(
				{
					ticketTypeId: 'tt-fc-1',
					price: 3000,
					quantity: 200,
					perAccountLimit: 4,
				},
				expect.any(AbortSignal),
			)
			expect(vm.quantity).toBe(200)
			expect(d.load).toHaveBeenCalledWith(SALES_HREF)
			await fixture.tearDown()
		})

		it('after a refusal, re-reads the counts and puts back a price that became fixed', async () => {
			const before = stored()
			const after = stored({ sold: 1 })
			const listByEvent = vi
				.fn()
				.mockResolvedValueOnce({ ticketSales: [before] })
				.mockResolvedValueOnce({ ticketSales: [after] })
			const { fixture, vm, d } = await mount({
				listByEvent,
				update: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('price locked', Code.FailedPrecondition),
					),
			})
			vm.model.price = '5000'

			await vm.save()

			expect(vm.saveProblem).toBe('firstComeEditor.rejected')
			expect(listByEvent).toHaveBeenCalledTimes(2)
			expect(vm.sale).toBe(after)
			expect(vm.priceLocked).toBe(true)
			expect(vm.model.price).toBe('3000')
			expect(d.showError).not.toHaveBeenCalled()
			await fixture.tearDown()
		})

		it('keeps the refusal shown when re-reading the counts fails', async () => {
			const listByEvent = vi
				.fn()
				.mockResolvedValueOnce({ ticketSales: [stored()] })
				.mockRejectedValueOnce(new ConnectError('down', Code.Unavailable))
			const { fixture, vm } = await mount({
				listByEvent,
				update: vi
					.fn()
					.mockRejectedValue(
						new ConnectError('refused', Code.FailedPrecondition),
					),
			})
			const warn = vi.spyOn(vm['logger'], 'warn')
			vm.model.price = '5000'

			await vm.save()

			expect(vm.saveProblem).toBe('firstComeEditor.rejected')
			expect(warn).toHaveBeenCalledWith(
				'Refreshing the sale failed',
				expect.any(ConnectError),
			)
			expect(vm.model.price).toBe('5000')
			await fixture.tearDown()
		})
	})
})
