import {
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { LotteryEntryStatsSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../../helpers/create-container'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ITicketSaleClient = DI.createInterface('ITicketSaleClient')

vi.mock('../../../organizer/services/ticket-sale-client', async (original) => ({
	...(await original<
		typeof import('../../../organizer/services/ticket-sale-client')
	>()),
	ITicketSaleClient,
}))

const { LotteryStatusRoute } = await import(
	'../../../organizer/lottery-status/lottery-status-route'
)

interface MockClient {
	listByEvent: ReturnType<typeof vi.fn>
}

function build(client: MockClient): InstanceType<typeof LotteryStatusRoute> {
	const container = createTestContainer(
		Registration.instance(ITicketSaleClient, client),
	)
	container.register(LotteryStatusRoute)
	const vm = container.get(LotteryStatusRoute)
	vm.canLoad({ eventId: 'event-1' })
	return vm
}

interface SaleOverrides {
	open?: Date
	close?: Date
	drawCompleted?: boolean
	method?: TicketSaleMethod
}

/** A sale of event-1 with TicketType type-1: 200 tickets, 4 each, 6500 yen. */
function makeSale(o: SaleOverrides = {}) {
	return create(TicketSaleSchema, {
		id: { value: 'sale-1' },
		name: { value: 'ファンクラブ先行' },
		method: o.method ?? TicketSaleMethod.LOTTERY,
		saleStartTime: timestampFromDate(o.open ?? new Date(Date.now() - 60_000)),
		saleEndTime: timestampFromDate(o.close ?? new Date(Date.now() + 60_000)),
		drawTime: o.drawCompleted ? timestampFromDate(new Date()) : undefined,
		ticketTypes: [
			{
				id: { value: 'type-1' },
				eventId: { value: 'event-1' },
				price: { value: 6500n },
				quantity: 200,
				perAccountLimit: 4,
			},
		],
	})
}

function stats(o: Partial<Record<string, number>> = {}) {
	return create(LotteryEntryStatsSchema, {
		ticketTypeId: { value: 'type-1' },
		entryCount: o.entryCount ?? 0,
		ticketCount: o.ticketCount ?? 0,
		wonEntryCount: o.wonEntryCount ?? 0,
		wonTicketCount: o.wonTicketCount ?? 0,
		lostEntryCount: o.lostEntryCount ?? 0,
	})
}

function createMockClient(
	sales = [makeSale()],
	entryStats = [stats()],
): MockClient {
	return {
		listByEvent: vi
			.fn()
			.mockResolvedValue({ ticketSales: sales, lotteryEntryStats: entryStats }),
	}
}

describe('LotteryStatusRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it("reads the event's sales and shows an open window with pre-draw entry stats", async () => {
		const client = createMockClient(
			[makeSale()],
			[stats({ entryCount: 12, ticketCount: 30 })],
		)
		const vm = build(client)
		await vm.load()

		expect(client.listByEvent).toHaveBeenCalledWith(
			'event-1',
			expect.anything(),
		)
		expect(vm.phase).toBe('ready')
		expect(vm.views).toHaveLength(1)
		const [view] = vm.views
		expect(view.name).toBe('ファンクラブ先行')
		expect(view.windowOpen).toBe(true)
		expect(view.windowLabel).toBe('Open')
		expect(view.quantity).toBe(200)
		expect(view.perAccountLimit).toBe(4)
		expect(view.price).toBe(6500)
		expect(view.drawCompleted).toBe(false)
		expect(view.entryCount).toBe(12)
		expect(view.ticketCount).toBe(30)
	})

	it('labels a not-yet-open window', async () => {
		const vm = build(
			createMockClient([
				makeSale({
					open: new Date(Date.now() + 60_000),
					close: new Date(Date.now() + 120_000),
				}),
			]),
		)
		await vm.load()
		expect(vm.views[0].windowLabel).toBe('Not yet open')
		expect(vm.views[0].windowOpen).toBe(false)
	})

	it('shows a closed, drawn lottery with its outcome stats', async () => {
		const vm = build(
			createMockClient(
				[
					makeSale({
						open: new Date(Date.now() - 120_000),
						close: new Date(Date.now() - 60_000),
						drawCompleted: true,
					}),
				],
				[
					stats({
						entryCount: 50,
						ticketCount: 120,
						wonEntryCount: 40,
						wonTicketCount: 100,
						lostEntryCount: 10,
					}),
				],
			),
		)
		await vm.load()
		const [view] = vm.views
		expect(view.windowLabel).toBe('Closed')
		expect(view.drawCompleted).toBe(true)
		expect(view.wonEntryCount).toBe(40)
		expect(view.wonTicketCount).toBe(100)
		expect(view.lostEntryCount).toBe(10)
	})

	it('shows only the lottery sales of the event', async () => {
		const vm = build(
			createMockClient([makeSale({ method: TicketSaleMethod.FIRST_COME })]),
		)
		await vm.load()
		expect(vm.views).toEqual([])
		expect(vm.isEmpty).toBe(true)
	})

	it('surfaces a PERMISSION_DENIED error state', async () => {
		const client: MockClient = {
			listByEvent: vi
				.fn()
				.mockRejectedValue(new ConnectError('nope', Code.PermissionDenied)),
		}
		const vm = build(client)
		await vm.load()
		expect(vm.phase).toBe('error')
		expect(vm.loadError).not.toBe('')
	})
})
