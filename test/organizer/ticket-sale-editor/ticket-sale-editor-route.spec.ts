import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	type Organizer,
	OrganizerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type TicketSale,
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketTypeSchema,
	TicketTypeState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthoredSeries } from '../../../organizer/services/concert-authoring-client'
import { authoredSeries } from '../authored-series'

// Replace the RPC client modules with fresh interface tokens so the route
// binds to test doubles instead of building real Connect transports.
const IConcertAuthoringClient = DI.createInterface('IConcertAuthoringClient')
vi.mock('../../../organizer/services/concert-authoring-client', () => ({
	IConcertAuthoringClient,
}))
const IOrganizerIdentityClient = DI.createInterface('IOrganizerIdentityClient')
vi.mock('../../../organizer/services/organizer-identity-client', () => ({
	IOrganizerIdentityClient,
}))
const ITicketSaleClient = DI.createInterface('ITicketSaleClient')
vi.mock('../../../organizer/services/ticket-sale-client', () => ({
	ITicketSaleClient,
}))
const ITicketTypeClient = DI.createInterface('ITicketTypeClient')
vi.mock('../../../organizer/services/ticket-type-client', () => ({
	ITicketTypeClient,
}))

const { TicketSaleEditorRoute, hasCompleteBusinessDetails } = await import(
	'../../../organizer/ticket-sale-editor/ticket-sale-editor-route'
)

type Route = InstanceType<typeof TicketSaleEditorRoute>

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))

function concertWith(
	opts: { startTime?: boolean; publishState?: PublishState } = {},
): AuthoredSeries[] {
	const { startTime = true, publishState = PublishState.PUBLISHED } = opts
	return [
		authoredSeries({
			series: {
				id: { value: 'series-1' },
				title: { value: 'One-Man Live' },
				publishState,
			},
			events: [
				{
					id: { value: 'event-1' },
					localDate: { value: { year: 2026, month: 11, day: 20 } },
					...(startTime
						? { startTime: { value: timestampFromDate(EVENT_START) } }
						: {}),
				},
			],
		}),
	]
}

function organizerWith(businessDetails: boolean): Organizer {
	return create(OrganizerSchema, {
		id: { value: 'org-1' },
		...(businessDetails
			? {
					legalName: { value: 'Liverty Live Inc.' },
					representativeName: { value: 'Taro Yamada' },
					businessAddress: { value: 'Tokyo' },
					businessPhoneNumber: { value: '+81312345678' },
					contactEmail: { value: 'shop@example.com' },
				}
			: {}),
	})
}

/** A ticket type of event-1: 150 tickets at 3000 yen, 4 per account. */
function typeWith(
	counts: { sold: number; held: number },
	o: { quantity?: number } = {},
) {
	return create(TicketTypeSchema, {
		id: { value: 'type-1' },
		ticketSaleId: { value: 'sale-1' },
		eventId: { value: 'event-1' },
		price: { value: 3000n },
		perAccountLimit: 4,
		quantity: o.quantity ?? 150,
		soldCount: counts.sold,
		heldCount: counts.held,
		state: TicketTypeState.ON_SALE,
	})
}

/** The event's 一般発売 first-come sale, from 2026-11-01 12:00 to the show. */
function saleWith(
	counts: { sold: number; held: number },
	o: { end?: Date; quantity?: number } = {},
): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: 'sale-1' },
		name: { value: '一般発売' },
		method: TicketSaleMethod.FIRST_COME,
		saleStartTime: timestampFromDate(new Date(Date.UTC(2026, 10, 1, 3, 0))),
		saleEndTime: timestampFromDate(o.end ?? EVENT_START),
		ticketTypes: [typeWith(counts, { quantity: o.quantity })],
	})
}

/** The event's lottery presale from 1 to 10 November (Japan time). */
function presale(): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: 'presale' },
		name: { value: 'ファンクラブ先行' },
		method: TicketSaleMethod.LOTTERY,
		saleStartTime: timestampFromDate(new Date(Date.UTC(2026, 9, 31, 15, 0))),
		saleEndTime: timestampFromDate(new Date(Date.UTC(2026, 10, 10, 14, 59))),
		ticketTypes: [
			{
				id: { value: 'presale-type' },
				eventId: { value: 'event-1' },
				price: { value: 8000n },
				perAccountLimit: 4,
				quantity: 100,
			},
		],
	})
}

interface Mocks {
	concerts: { list: ReturnType<typeof vi.fn> }
	organizers: { get: ReturnType<typeof vi.fn> }
	ticketSales: {
		listByEvent: ReturnType<typeof vi.fn>
		create: ReturnType<typeof vi.fn>
		setWindow: ReturnType<typeof vi.fn>
	}
	ticketTypes: { update: ReturnType<typeof vi.fn> }
}

function mocks(
	opts: {
		concerts?: AuthoredSeries[]
		organizer?: Organizer
		sales?: TicketSale[]
	} = {},
): Mocks {
	return {
		concerts: {
			list: vi.fn().mockResolvedValue(opts.concerts ?? concertWith()),
		},
		organizers: {
			get: vi.fn().mockResolvedValue(opts.organizer ?? organizerWith(true)),
		},
		ticketSales: {
			listByEvent: vi.fn().mockResolvedValue({
				ticketSales: opts.sales ?? [],
				lotteryEntryStats: [],
			}),
			create: vi
				.fn()
				.mockImplementation(async () => saleWith({ sold: 0, held: 0 })),
			setWindow: vi.fn(),
		},
		ticketTypes: { update: vi.fn() },
	}
}

/** Answer the listByEvent read with these sales. */
function listing(sales: TicketSale[]) {
	return { ticketSales: sales, lotteryEntryStats: [] }
}

/** Renders the real template for event-1 and waits for the load. */
async function render(m: Mocks): Promise<{ vm: Route; host: HTMLElement }> {
	const fixture = createFixture
		.html(
			'<ticket-sale-editor-route component.ref="route"></ticket-sale-editor-route>',
		)
		.deps(
			TicketSaleEditorRoute,
			Registration.instance(IConcertAuthoringClient, m.concerts),
			Registration.instance(IOrganizerIdentityClient, m.organizers),
			Registration.instance(ITicketSaleClient, m.ticketSales),
			Registration.instance(ITicketTypeClient, m.ticketTypes),
		)
		.build()
	await fixture.started
	const vm = (fixture.component as { route: Route }).route
	vm.canLoad({ eventId: 'event-1' })
	await vm.load()
	await tasksSettled()
	return { vm, host: fixture.appHost }
}

function input(host: HTMLElement, name: string): HTMLInputElement | null {
	return host.querySelector<HTMLInputElement>(`input[name="${name}"]`)
}

function fillValid(vm: Route): void {
	vm.model.saleStart = '2026-11-01T12:00'
	vm.model.saleEnd = '2026-11-20T19:00'
	vm.model.price = '3000'
	vm.model.quantity = '150'
	vm.model.perAccountLimit = '4'
}

describe('TicketSaleEditorRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	describe('sale settings with sensible defaults', () => {
		it('defaults the end time to the event start, the name to 一般発売 and the limit to 4', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Blank form"
			const { vm, host } = await render(mocks())

			expect(vm.model.saleEnd).toBe('2026-11-20T19:00')
			expect(vm.model.name).toBe('一般発売')
			expect(vm.model.perAccountLimit).toBe('4')
			expect(input(host, 'saleEnd')?.value).toBe('2026-11-20T19:00')
			expect(input(host, 'name')?.value).toBe('一般発売')
			expect(input(host, 'perAccountLimit')?.value).toBe('4')
			expect(input(host, 'price')).not.toBeNull()
			expect(host.textContent).toContain('税込')
		})

		it('shows an error next to the end time and saves nothing when the sale ends after the show starts', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "End after the show starts"
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)
			vm.model.saleEnd = '2026-11-20T19:30'

			host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
			await tasksSettled()

			expect(m.ticketSales.create).not.toHaveBeenCalled()
			const error = host.querySelector('[data-error="saleEnd"]')
			expect(error?.textContent).toContain('開演時刻')
			expect(
				input(host, 'saleEnd')?.getAttribute('aria-describedby')?.split(' '),
			).toContain(error?.id)
			expect(input(host, 'saleEnd')?.getAttribute('aria-invalid')).toBe('true')
		})

		it('says the window overlaps the presale and saves nothing', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Overlapping a presale"
			const m = mocks({ sales: [presale()] })
			const { vm, host } = await render(m)
			fillValid(vm)
			vm.model.saleStart = '2026-11-08T12:00'

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.create).not.toHaveBeenCalled()
			const error = host.querySelector('[data-error="saleStart"]')
			expect(error?.textContent).toContain('ほかの販売「ファンクラブ先行」')
			expect(error?.textContent).toContain('重なっています')
		})

		it('rejects an empty name, an end not after the start, an out-of-range price, a quantity below 1 and a limit outside 1 to 10', async () => {
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)
			vm.model.name = ' '
			vm.model.saleEnd = '2026-11-01T12:00'
			vm.model.price = '1000001'
			vm.model.quantity = '0'
			vm.model.perAccountLimit = '11'

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.create).not.toHaveBeenCalled()
			for (const field of [
				'name',
				'saleEnd',
				'price',
				'quantity',
				'perAccountLimit',
			]) {
				expect(host.querySelector(`[data-error="${field}"]`)).not.toBeNull()
			}
			expect(vm.errors.saleEnd).toContain('販売開始より後')
		})

		it('rejects a limit above the quantity', async () => {
			const { vm } = await render(mocks())
			fillValid(vm)
			vm.model.quantity = '3'

			await vm.save()

			expect(vm.errors.perAccountLimit).toContain('販売数以下')
		})

		it('creates a FirstCome sale of the Series with one TicketType for the event', async () => {
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.create).toHaveBeenCalledTimes(1)
			const [arg] = m.ticketSales.create.mock.calls[0]
			expect(arg).toMatchObject({
				seriesId: 'series-1',
				name: '一般発売',
				method: 'firstCome',
				eventId: 'event-1',
				price: 3000,
				quantity: 150,
				perAccountLimit: 4,
			})
			expect(arg.saleStartTime.toISOString()).toBe('2026-11-01T03:00:00.000Z')
			expect(arg.saleEndTime.toISOString()).toBe(EVENT_START.toISOString())
			expect(vm.saved).toBe(true)
			expect(host.querySelector('[data-count="quantity"]')?.textContent).toBe(
				'150枚',
			)
		})
	})

	describe('what can change once the sale has started', () => {
		it('shows the price as fixed while a checkout holds tickets', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Price locked"
			const m = mocks({ sales: [saleWith({ sold: 0, held: 2 })] })
			const { vm, host } = await render(m)

			expect(m.ticketSales.listByEvent).toHaveBeenCalledWith(
				'event-1',
				expect.anything(),
			)
			expect(vm.priceLocked).toBe(true)
			expect(input(host, 'price')).toBeNull()
			const locked = host.querySelector('[data-state="price-locked"]')
			expect(locked?.textContent).toContain('¥3,000')
			expect(locked?.textContent).toContain('確保中または販売済みの間は')
			expect(locked?.textContent).toContain('固定')
			expect(host.querySelector('[data-count="held"]')?.textContent).toBe('2枚')
		})

		it('updates the TicketType when the quantity is raised and shows it', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "More tickets"
			const m = mocks({ sales: [saleWith({ sold: 10, held: 0 })] })
			m.ticketTypes.update.mockResolvedValue(
				typeWith({ sold: 10, held: 0 }, { quantity: 180 }),
			)
			const { vm, host } = await render(m)
			vm.model.quantity = '180'

			await vm.save()
			await tasksSettled()

			expect(m.ticketTypes.update).toHaveBeenCalledWith({
				ticketTypeId: 'type-1',
				price: 3000,
				quantity: 180,
				perAccountLimit: 4,
			})
			expect(m.ticketSales.setWindow).not.toHaveBeenCalled()
			expect(host.querySelector('[data-count="quantity"]')?.textContent).toBe(
				'180枚',
			)
		})

		it('moves only the window when the end time is moved later', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Sale extended"
			const earlyEnd = new Date(Date.UTC(2026, 10, 19, 10, 0))
			const m = mocks({
				sales: [saleWith({ sold: 0, held: 0 }, { end: earlyEnd })],
			})
			m.ticketSales.setWindow.mockResolvedValue(saleWith({ sold: 0, held: 0 }))
			const { vm } = await render(m)
			expect(vm.model.saleEnd).toBe('2026-11-19T19:00')
			vm.model.saleEnd = '2026-11-20T19:00'

			await vm.save()

			expect(m.ticketSales.setWindow).toHaveBeenCalledWith(
				'sale-1',
				new Date(Date.UTC(2026, 10, 1, 3, 0)),
				EVENT_START,
			)
			expect(m.ticketTypes.update).not.toHaveBeenCalled()
			expect(vm.model.saleEnd).toBe('2026-11-20T19:00')
			expect(vm.model.price).toBe('3000')
			expect(vm.model.quantity).toBe('150')
			expect(vm.model.perAccountLimit).toBe('4')
		})

		it('shows the quantity, sold and held counts and keeps the price editable while nothing is sold or held', async () => {
			const { vm, host } = await render(
				mocks({ sales: [saleWith({ sold: 0, held: 0 })] }),
			)
			expect(vm.priceLocked).toBe(false)
			expect(input(host, 'price')?.value).toBe('3000')
			expect(input(host, 'name')).toBeNull()
			expect(host.querySelector('[data-count="quantity"]')?.textContent).toBe(
				'150枚',
			)
			expect(host.querySelector('[data-count="sold"]')?.textContent).toBe('0枚')
		})

		it('refuses a quantity below what is sold and held, saying why', async () => {
			const m = mocks({ sales: [saleWith({ sold: 100, held: 6 })] })
			const { vm, host } = await render(m)
			vm.model.quantity = '105'

			await vm.save()
			await tasksSettled()

			expect(m.ticketTypes.update).not.toHaveBeenCalled()
			const error = host.querySelector('[data-error="quantity"]')
			expect(error?.textContent).toContain('販売済み100枚と確保中6枚')
		})

		it('works on the first-come sale of the event, not its lottery presale', async () => {
			const m = mocks({ sales: [presale(), saleWith({ sold: 0, held: 0 })] })
			const { vm } = await render(m)

			expect(vm.sale?.id?.value).toBe('sale-1')
			expect(vm.ticketType?.id?.value).toBe('type-1')
		})
	})

	describe('prerequisites explained', () => {
		it('says to set the start time in the concert editor first and links to it', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "No start time"
			const m = mocks({ concerts: concertWith({ startTime: false }) })
			const { vm, host } = await render(m)

			expect(vm.blocks).toEqual(['no-start-time'])
			const block = host.querySelector('[data-block="no-start-time"]')
			expect(block?.textContent).toContain('公演エディターで開演時刻を設定')
			const link = block?.querySelector('a')
			// Without a router in the fixture, the interpolated `load` lands on the
			// element's property; with the router it is the navigation target.
			expect((link as unknown as { load?: string } | null)?.load).toBe(
				'../concerts/edit/series-1',
			)
			expect(host.querySelector('form')).toBeNull()

			fillValid(vm)
			await vm.save()
			expect(m.ticketSales.create).not.toHaveBeenCalled()
		})

		it('says business details are entered by Liverty Music during vetting and offers no save', async () => {
			const m = mocks({ organizer: organizerWith(false) })
			const { vm, host } = await render(m)

			expect(vm.blocks).toEqual(['no-business-details'])
			const block = host.querySelector('[data-block="no-business-details"]')
			expect(block?.textContent).toContain('審査の際に')
			expect(block?.textContent).toContain('Liverty Music が入力します')
			expect(host.querySelector('form')).toBeNull()
		})

		it('says the event is not published and lists every missing prerequisite', async () => {
			const m = mocks({
				concerts: concertWith({
					startTime: false,
					publishState: PublishState.DRAFT,
				}),
				organizer: organizerWith(false),
			})
			const { vm, host } = await render(m)

			expect(vm.blocks).toEqual([
				'not-published',
				'no-start-time',
				'no-business-details',
			])
			expect(host.querySelector('[data-block="not-published"]')).not.toBeNull()
			expect(host.querySelector('form')).toBeNull()
		})

		it('treats business details with an empty field as incomplete', () => {
			const organizer = organizerWith(true)
			expect(hasCompleteBusinessDetails(organizer)).toBe(true)
			organizer.businessAddress = {
				$typeName: 'liverty_music.entity.v1.BusinessAddress',
				value: ' ',
			}
			expect(hasCompleteBusinessDetails(organizer)).toBe(false)
			expect(hasCompleteBusinessDetails(undefined)).toBe(false)
		})
	})

	describe('save errors', () => {
		it('explains a FailedPrecondition and refreshes the counts', async () => {
			const m = mocks({ sales: [saleWith({ sold: 0, held: 0 })] })
			m.ticketTypes.update.mockRejectedValue(
				new ConnectError('price locked', Code.FailedPrecondition),
			)
			const { vm, host } = await render(m)
			m.ticketSales.listByEvent.mockResolvedValue(
				listing([saleWith({ sold: 0, held: 3 })]),
			)
			vm.model.price = '3500'

			await vm.save()
			await tasksSettled()

			expect(vm.saveError).toContain('価格を変更できず')
			expect(vm.saveError).toContain('期間が重なっていないか')
			expect(host.querySelector('[role="alert"]')?.textContent).toContain(
				'保存できませんでした',
			)
			expect(vm.priceLocked).toBe(true)
			expect(vm.model.price).toBe('3000')
		})

		it('shows an InvalidArgument with the server reason', async () => {
			const m = mocks()
			m.ticketSales.create.mockRejectedValue(
				new ConnectError('sale_end_time is after start', Code.InvalidArgument),
			)
			const { vm } = await render(m)
			fillValid(vm)

			await vm.save()

			expect(vm.saveError).toContain('入力内容が受け付けられませんでした')
			expect(vm.saveError).toContain('sale_end_time is after start')
		})
	})

	describe('loading', () => {
		it('says the event was not found when it is not among the operator concerts', async () => {
			const { vm, host } = await render(mocks({ concerts: [] }))
			expect(vm.phase).toBe('not-found')
			expect(host.textContent).toContain('見つかりませんでした')
		})

		it('shows a load error with a retry', async () => {
			const m = mocks()
			m.organizers.get.mockRejectedValue(new Error('offline'))
			const { vm, host } = await render(m)
			expect(vm.phase).toBe('error')
			expect(host.querySelector('[data-state="error"] button')).not.toBeNull()
		})
	})
})
