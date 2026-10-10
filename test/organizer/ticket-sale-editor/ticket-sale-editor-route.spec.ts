import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	type Organizer,
	OrganizerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type TicketSale,
	TicketSaleSchema,
	TicketSaleState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	type AuthoredConcert,
	AuthoredConcertSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/concert/v1/concert_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { TicketSaleEditorRoute, hasCompleteSellerDetails } = await import(
	'../../../organizer/ticket-sale-editor/ticket-sale-editor-route'
)

type Route = InstanceType<typeof TicketSaleEditorRoute>

/** 2026-11-20 19:00 in Japan time. */
const EVENT_START = new Date(Date.UTC(2026, 10, 20, 10, 0))

function concertWith(
	opts: { startTime?: boolean; publishState?: PublishState } = {},
): AuthoredConcert[] {
	const { startTime = true, publishState = PublishState.PUBLISHED } = opts
	return [
		create(AuthoredConcertSchema, {
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

function organizerWith(sellerDetails: boolean): Organizer {
	return create(OrganizerSchema, {
		id: { value: 'org-1' },
		...(sellerDetails
			? {
					sellerDetails: {
						legalName: 'Liverty Live Inc.',
						representativeName: 'Taro Yamada',
						address: 'Tokyo',
						phoneNumber: '+81312345678',
						contactEmail: 'shop@example.com',
					},
				}
			: {}),
	})
}

function saleWith(counts: { sold: number; held: number }): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: 'sale-1' },
		eventId: { value: 'event-1' },
		saleStartTime: timestampFromDate(new Date(Date.UTC(2026, 10, 1, 3, 0))),
		saleEndTime: timestampFromDate(EVENT_START),
		price: 3000n,
		perAccountLimit: 4,
		quantity: 150,
		soldCount: counts.sold,
		heldCount: counts.held,
		state: TicketSaleState.ON_SALE,
	})
}

interface Mocks {
	concerts: { list: ReturnType<typeof vi.fn> }
	organizers: { get: ReturnType<typeof vi.fn> }
	ticketSales: {
		get: ReturnType<typeof vi.fn>
		configure: ReturnType<typeof vi.fn>
	}
}

function mocks(
	opts: {
		concerts?: AuthoredConcert[]
		organizer?: Organizer
		sale?: TicketSale
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
			get: vi.fn().mockResolvedValue(opts.sale),
			configure: vi
				.fn()
				.mockImplementation(async () => saleWith({ sold: 0, held: 0 })),
		},
	}
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
		it('defaults the sale end to the event start and the limit to 4', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Blank form"
			const { vm, host } = await render(mocks())

			expect(vm.model.saleEnd).toBe('2026-11-20T19:00')
			expect(vm.model.perAccountLimit).toBe('4')
			expect(input(host, 'saleEnd')?.value).toBe('2026-11-20T19:00')
			expect(input(host, 'perAccountLimit')?.value).toBe('4')
			expect(input(host, 'price')).not.toBeNull()
			expect(host.textContent).toContain('税込')
		})

		it('shows an error next to the sale end and saves nothing when the sale ends after the show starts', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "End after the show starts"
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)
			vm.model.saleEnd = '2026-11-20T19:30'

			host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
			await tasksSettled()

			expect(m.ticketSales.configure).not.toHaveBeenCalled()
			const error = host.querySelector('[data-error="saleEnd"]')
			expect(error?.textContent).toContain('開演時刻')
			expect(
				input(host, 'saleEnd')?.getAttribute('aria-describedby')?.split(' '),
			).toContain(error?.id)
			expect(input(host, 'saleEnd')?.getAttribute('aria-invalid')).toBe('true')
		})

		it('rejects an end that is not after the start, an out-of-range price, a quantity below 1 and a limit outside 1 to 10', async () => {
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)
			vm.model.saleEnd = '2026-11-01T12:00'
			vm.model.price = '1000001'
			vm.model.quantity = '0'
			vm.model.perAccountLimit = '11'

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.configure).not.toHaveBeenCalled()
			for (const field of ['saleEnd', 'price', 'quantity', 'perAccountLimit']) {
				expect(host.querySelector(`[data-error="${field}"]`)).not.toBeNull()
			}
			expect(vm.errors.saleEnd).toContain('販売開始より後')
		})

		it('configures the sale with Japan-time instants and shows the result', async () => {
			const m = mocks()
			const { vm, host } = await render(m)
			fillValid(vm)

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.configure).toHaveBeenCalledTimes(1)
			const [arg] = m.ticketSales.configure.mock.calls[0]
			expect(arg.eventId).toBe('event-1')
			expect(arg.saleStartTime.toISOString()).toBe('2026-11-01T03:00:00.000Z')
			expect(arg.saleEndTime.toISOString()).toBe(EVENT_START.toISOString())
			expect(arg.price).toBe(3000)
			expect(arg.quantity).toBe(150)
			expect(arg.perAccountLimit).toBe(4)
			expect(vm.saved).toBe(true)
			expect(host.querySelector('[data-count="quantity"]')?.textContent).toBe(
				'150枚',
			)
		})
	})

	describe('what can change once the sale has started', () => {
		it('shows the price as fixed while a checkout holds tickets', async () => {
			// @spec components/infrastructure/organizer/web/route/ticket-sale-editor "Price locked"
			const m = mocks({ sale: saleWith({ sold: 0, held: 2 }) })
			const { vm, host } = await render(m)

			expect(vm.priceLocked).toBe(true)
			expect(input(host, 'price')).toBeNull()
			const locked = host.querySelector('[data-state="price-locked"]')
			expect(locked?.textContent).toContain('¥3,000')
			expect(locked?.textContent).toContain('確保中または販売済みの間は')
			expect(locked?.textContent).toContain('固定')
			expect(host.querySelector('[data-count="held"]')?.textContent).toBe('2枚')

			await vm.save()
			expect(m.ticketSales.configure.mock.calls[0][0].price).toBe(3000)
		})

		it('shows the quantity, sold and held counts and keeps the price editable while nothing is sold or held', async () => {
			const { vm, host } = await render(
				mocks({ sale: saleWith({ sold: 0, held: 0 }) }),
			)
			expect(vm.priceLocked).toBe(false)
			expect(input(host, 'price')?.value).toBe('3000')
			expect(host.querySelector('[data-count="quantity"]')?.textContent).toBe(
				'150枚',
			)
			expect(host.querySelector('[data-count="sold"]')?.textContent).toBe('0枚')
		})

		it('refuses a quantity below what is sold and held, saying why', async () => {
			const m = mocks({ sale: saleWith({ sold: 100, held: 6 }) })
			const { vm, host } = await render(m)
			vm.model.quantity = '105'

			await vm.save()
			await tasksSettled()

			expect(m.ticketSales.configure).not.toHaveBeenCalled()
			const error = host.querySelector('[data-error="quantity"]')
			expect(error?.textContent).toContain('販売済み100枚と確保中6枚')
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
			expect(m.ticketSales.configure).not.toHaveBeenCalled()
		})

		it('says seller details are entered by Liverty Music during vetting and offers no save', async () => {
			const m = mocks({ organizer: organizerWith(false) })
			const { vm, host } = await render(m)

			expect(vm.blocks).toEqual(['no-seller-details'])
			const block = host.querySelector('[data-block="no-seller-details"]')
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
				'no-seller-details',
			])
			expect(host.querySelector('[data-block="not-published"]')).not.toBeNull()
			expect(host.querySelector('form')).toBeNull()
		})

		it('treats seller details with an empty field as incomplete', () => {
			const organizer = organizerWith(true)
			expect(hasCompleteSellerDetails(organizer)).toBe(true)
			if (organizer.sellerDetails) organizer.sellerDetails.address = ' '
			expect(hasCompleteSellerDetails(organizer)).toBe(false)
			expect(hasCompleteSellerDetails(undefined)).toBe(false)
		})
	})

	describe('configure errors', () => {
		it('explains a FailedPrecondition and refreshes the counts', async () => {
			const m = mocks({ sale: saleWith({ sold: 0, held: 0 }) })
			m.ticketSales.configure.mockRejectedValue(
				new ConnectError('price locked', Code.FailedPrecondition),
			)
			const { vm, host } = await render(m)
			m.ticketSales.get.mockResolvedValue(saleWith({ sold: 0, held: 3 }))
			vm.model.price = '3500'

			await vm.save()
			await tasksSettled()

			expect(vm.saveError).toContain('価格を変更できず')
			expect(host.querySelector('[role="alert"]')?.textContent).toContain(
				'保存できませんでした',
			)
			expect(vm.priceLocked).toBe(true)
			expect(vm.model.price).toBe('3000')
		})

		it('shows an InvalidArgument with the server reason', async () => {
			const m = mocks()
			m.ticketSales.configure.mockRejectedValue(
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
