import { IRouter } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	type TicketSale,
	TicketSaleMethod,
	TicketSaleSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyFormModel } from '../../../organizer/lottery-phase-editor/lottery-phase-form'
import type { AuthoredSeries } from '../../../organizer/services/concert-authoring-client'
import { createTestContainer } from '../../helpers/create-container'
import { authoredSeries } from '../authored-series'

// Replace the RPC client module with a fresh interface token so the route binds
// to the test double instead of building a real Connect transport.
const ITicketSaleClient = DI.createInterface('ITicketSaleClient')

vi.mock('../../../organizer/services/ticket-sale-client', async (original) => ({
	...(await original<
		typeof import('../../../organizer/services/ticket-sale-client')
	>()),
	ITicketSaleClient,
}))

const IConcertAuthoringClient = DI.createInterface('IConcertAuthoringClient')
vi.mock('../../../organizer/services/concert-authoring-client', () => ({
	IConcertAuthoringClient,
}))

const { LotteryPhaseEditorRoute } = await import(
	'../../../organizer/lottery-phase-editor/lottery-phase-editor-route'
)

type Route = InstanceType<typeof LotteryPhaseEditorRoute>

interface MockClient {
	create: ReturnType<typeof vi.fn>
	listByEvent: ReturnType<typeof vi.fn>
}

interface MockRouter {
	load: ReturnType<typeof vi.fn>
}

function createMockClient(overrides: Partial<MockClient> = {}): MockClient {
	return {
		create: vi.fn().mockResolvedValue(undefined),
		listByEvent: vi
			.fn()
			.mockResolvedValue({ ticketSales: [], lotteryEntryStats: [] }),
		...overrides,
	}
}

function makeSale(id: string, o: Partial<TicketSale> = {}): TicketSale {
	return create(TicketSaleSchema, { id: { value: id }, ...o })
}

/** The operator's concerts, holding event-1 with or without a start time. */
function concertsWith(startTime: boolean): AuthoredSeries[] {
	return [
		authoredSeries({
			series: { id: { value: 'series-1' } },
			events: [
				{
					id: { value: 'event-1' },
					...(startTime
						? {
								startTime: {
									value: timestampFromDate(new Date(2026, 11, 20, 19, 0)),
								},
							}
						: {}),
				},
			],
		}),
	]
}

function build(
	client: MockClient,
	router: MockRouter = { load: vi.fn().mockResolvedValue(undefined) },
	concerts: { list: ReturnType<typeof vi.fn> } = {
		list: vi.fn().mockResolvedValue(concertsWith(true)),
	},
): Route {
	const container = createTestContainer(
		Registration.instance(ITicketSaleClient, client),
		Registration.instance(IRouter, router),
		Registration.instance(IConcertAuthoringClient, concerts),
	)
	container.register(LotteryPhaseEditorRoute)
	const vm = container.get(LotteryPhaseEditorRoute)
	vm.canLoad({ eventId: 'event-1' })
	// The event check normally runs on attach.
	vm.eventCheck = 'ok'
	vm.seriesId = 'series-1'
	return vm
}

/** ファンクラブ先行 with the default 10-day window from 2026-11-01 12:00. */
function fillValid(vm: Route): void {
	vm.model = emptyFormModel(new Date(2026, 10, 1, 12, 0, 0))
	vm.model.name = 'ファンクラブ先行'
	vm.model.quantity = '100'
	vm.model.price = '8000'
	vm.revalidate()
}

describe('LotteryPhaseEditorRoute', () => {
	beforeEach(() => vi.clearAllMocks())

	it('captures the event id from the route param', () => {
		const vm = build(createMockClient())
		expect(vm.eventId).toBe('event-1')
	})

	it('does not submit an invalid form and shows errors', async () => {
		const client = createMockClient()
		const vm = build(client)
		vm.model = emptyFormModel(new Date(2026, 10, 1, 12, 0, 0)) // blank fields
		vm.revalidate()
		await vm.save()
		expect(vm.submitted).toBe(true)
		expect(vm.formValid).toBe(false)
		expect(client.create).not.toHaveBeenCalled()
	})

	it('creates a named Lottery sale with one TicketType for the event', async () => {
		// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Presale for one event"
		const client = createMockClient({
			create: vi.fn().mockResolvedValue(makeSale('sale-9')),
		})
		const vm = build(client)
		fillValid(vm)
		expect(vm.model.perAccountLimit).toBe('4')
		await vm.save()

		expect(client.create).toHaveBeenCalledTimes(1)
		const [input] = client.create.mock.calls[0]
		expect(input).toMatchObject({
			seriesId: 'series-1',
			name: 'ファンクラブ先行',
			method: 'lottery',
			eventId: 'event-1',
			quantity: 100,
			price: 8000,
			perAccountLimit: 4,
		})
		expect(input.saleEndTime.getTime() - input.saleStartTime.getTime()).toBe(
			10 * 24 * 60 * 60 * 1000,
		)
		expect(vm.phase).toBe('done')
		expect(vm.createdSaleId).toBe('sale-9')
		expect(vm.saveError).toBe('')
	})

	it('shows an error next to the name and saves nothing without a name', async () => {
		// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Missing name"
		const client = createMockClient()
		const fixture = createFixture
			.html(
				'<lottery-phase-editor-route component.ref="route"></lottery-phase-editor-route>',
			)
			.deps(
				LotteryPhaseEditorRoute,
				Registration.instance(ITicketSaleClient, client),
				Registration.instance(IRouter, { load: vi.fn() }),
				Registration.instance(IConcertAuthoringClient, {
					list: vi.fn().mockResolvedValue(concertsWith(true)),
				}),
			)
			.build()
		await fixture.started
		const vm = (fixture.component as { route: Route }).route
		vm.canLoad({ eventId: 'event-1' })
		await vm.checkEvent()
		fillValid(vm)
		vm.model.name = '  '

		await vm.save()
		await tasksSettled()

		expect(client.create).not.toHaveBeenCalled()
		const error = fixture.appHost.querySelector('[data-error="name"]')
		expect(error?.textContent).toContain('Enter a name')
		expect(
			fixture.appHost
				.querySelector('input[name="name"]')
				?.getAttribute('aria-describedby'),
		).toBe(error?.id)
	})

	it('says the window overlaps an existing sale of the event and saves nothing', async () => {
		// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Overlapping window"
		const existing = makeSale('presale', {
			name: { value: '先行抽選' },
			method: TicketSaleMethod.LOTTERY,
			saleStartTime: timestampFromDate(new Date(2026, 10, 1, 0, 0)),
			saleEndTime: timestampFromDate(new Date(2026, 10, 10, 23, 59)),
		})
		const client = createMockClient({
			listByEvent: vi
				.fn()
				.mockResolvedValue({ ticketSales: [existing], lotteryEntryStats: [] }),
		})
		const vm = build(client)
		await vm.checkEvent()
		fillValid(vm)
		vm.model.openTime = '2026-11-08T12:00'
		vm.model.closeTime = '2026-11-12T12:00'

		await vm.save()

		expect(client.create).not.toHaveBeenCalled()
		expect(vm.errors.window).toContain('overlaps the sale 「先行抽選」')
	})

	it('shows an error next to the window and saves nothing for a 15-day window', async () => {
		// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Window too long"
		const client = createMockClient()
		const vm = build(client)
		fillValid(vm)
		vm.model.closeTime = '2026-11-16T12:00'

		await vm.save()

		expect(client.create).not.toHaveBeenCalled()
		expect(vm.errors.window).toContain('1–14 days')
	})

	it('refuses a window that does not close before the event starts', async () => {
		const client = createMockClient()
		const vm = build(client)
		await vm.checkEvent()
		fillValid(vm)
		vm.model.openTime = '2026-12-15T12:00'
		vm.model.closeTime = '2026-12-20T19:00'

		await vm.save()

		expect(client.create).not.toHaveBeenCalled()
		expect(vm.errors.window).toContain('before the event starts')
	})

	it('surfaces FAILED_PRECONDITION copy', async () => {
		const client = createMockClient({
			create: vi
				.fn()
				.mockRejectedValue(new ConnectError('draft', Code.FailedPrecondition)),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.phase).toBe('ready')
		expect(vm.saveError).toContain('set its start time')
		expect(vm.saveError).toContain('overlap')
	})

	it('surfaces PERMISSION_DENIED copy', async () => {
		const client = createMockClient({
			create: vi
				.fn()
				.mockRejectedValue(new ConnectError('nope', Code.PermissionDenied)),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.saveError).toContain('not allowed')
	})

	it('surfaces INVALID_ARGUMENT raw message', async () => {
		const client = createMockClient({
			create: vi
				.fn()
				.mockRejectedValue(
					new ConnectError('quantity must be positive', Code.InvalidArgument),
				),
		})
		const vm = build(client)
		fillValid(vm)
		await vm.save()
		expect(vm.saveError).toContain('quantity must be positive')
	})

	it("navigates to the event's lottery status", async () => {
		const router = { load: vi.fn().mockResolvedValue(undefined) }
		const client = createMockClient({
			create: vi.fn().mockResolvedValue(makeSale('sale-9')),
		})
		const vm = build(client, router)
		fillValid(vm)
		await vm.save()
		await vm.viewStatus()
		expect(router.load).toHaveBeenCalledWith('../lottery/status/event-1')
	})

	describe('an event goes on sale only with its start time', () => {
		it('says the start time must be set first, links to the concert editor, and offers no save', async () => {
			// @spec components/infrastructure/organizer/web/route/lottery-phase-editor "Start time not set"
			const client = createMockClient()
			const concerts = { list: vi.fn().mockResolvedValue(concertsWith(false)) }
			const fixture = createFixture
				.html(
					'<lottery-phase-editor-route component.ref="route"></lottery-phase-editor-route>',
				)
				.deps(
					LotteryPhaseEditorRoute,
					Registration.instance(ITicketSaleClient, client),
					Registration.instance(IRouter, { load: vi.fn() }),
					Registration.instance(IConcertAuthoringClient, concerts),
				)
				.build()
			await fixture.started
			const vm = (fixture.component as { route: Route }).route
			vm.canLoad({ eventId: 'event-1' })
			await vm.checkEvent()

			expect(vm.eventCheck).toBe('no-start-time')
			const host = fixture.appHost
			expect(host.textContent).toContain('Set the start time first')
			const editorLink = Array.from(host.querySelectorAll('a')).find((a) =>
				a.textContent?.includes('concert editor'),
			)
			// Without a router in the fixture, the interpolated `load` lands on the
			// element's property; with the router it is the navigation target.
			expect(
				(editorLink as unknown as { load?: string } | undefined)?.load,
			).toBe('../concerts/edit/series-1')
			expect(host.querySelector('form')).toBeNull()
			expect(host.querySelector('button[type="submit"]')).toBeNull()

			fillValid(vm)
			await vm.save()
			expect(client.create).not.toHaveBeenCalled()
		})

		it('goes on sale as usual without an open time', async () => {
			const vm = build(createMockClient(), undefined, {
				list: vi.fn().mockResolvedValue(concertsWith(true)),
			})
			await vm.checkEvent()
			expect(vm.eventCheck).toBe('ok')
		})

		it('leaves the decision to the server when the event cannot be read', async () => {
			const vm = build(createMockClient(), undefined, {
				list: vi.fn().mockRejectedValue(new Error('offline')),
			})
			await vm.checkEvent()
			expect(vm.eventCheck).toBe('ok')
		})
	})
})
