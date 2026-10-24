import { createFixture } from '@aurelia/testing'
import { ArtistSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { EventSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	type Order,
	OrderSchema,
	OrderStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import {
	PublishState,
	SeriesSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConcert } from '../../../admin/services/concert-client'

// The route resolves IConcertClient + IOrderClient. Replace the real modules
// (which would build Connect transports) with fresh interface tokens so the
// fixture binds to the test doubles.
const IConcertClient = DI.createInterface('IConcertClient')
const IOrderClient = DI.createInterface('IOrderClient')

vi.mock('../../../admin/services/concert-client', () => ({ IConcertClient }))
vi.mock('../../../admin/services/order-client', () => ({ IOrderClient }))

const { ArtistConcertsRoute, DELETE_BLOCKED } = await import(
	'../../../admin/artist-concerts/artist-concerts-route'
)

const SPEC = 'components/infrastructure/admin/web/route/artist-concerts'
const STORY = 'stories/remove-a-cancelled-concert'
const ARTIST_ID = 'artist-1'

function concert(
	eventId: string,
	state: PublishState,
	firstParty = true,
): ResolvedConcert {
	return {
		event: create(EventSchema, {
			id: { value: eventId },
			seriesId: { value: `series-${eventId}` },
			localDate: { value: { year: 2026, month: 11, day: 20 } },
			venue: { name: { value: 'Zepp Haneda' } },
			publishState: state,
		}),
		series: create(SeriesSchema, {
			id: { value: `series-${eventId}` },
			title: { value: 'Test Tour' },
			...(firstParty ? { organizerId: { value: 'org-1' } } : {}),
		}),
		artists: [
			create(ArtistSchema, {
				id: { value: ARTIST_ID },
				name: { value: 'E2E Test Artist' },
			}),
		],
	}
}

function order(id: string, amount: number, status: OrderStatus): Order {
	return create(OrderSchema, {
		id: { value: id },
		amount: BigInt(amount),
		currency: 'JPY',
		status,
	})
}

const paid = (id: string, amount = 3000) => order(id, amount, OrderStatus.PAID)
const refunded = (id: string, amount = 3000) =>
	order(id, amount, OrderStatus.REFUNDED)

interface Clients {
	concert: { list: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
	order: {
		listByEvent: ReturnType<typeof vi.fn>
		refundCancellation: ReturnType<typeof vi.fn>
	}
}

/**
 * Test doubles. `orders[n]` is what ListByEvent returns once n refunds have
 * succeeded, so every re-read sees the Orders the refunds so far left.
 */
function clients(
	concerts: ResolvedConcert[],
	orders: Order[][] = [[]],
): Clients {
	let succeeded = 0
	const refundCancellation = vi.fn()
	const refund = vi.fn(async () => {
		await refundCancellation()
		succeeded++
	})
	const listByEvent = vi.fn(async () =>
		structuredClone(orders[Math.min(succeeded, orders.length - 1)] ?? []),
	)
	return {
		concert: {
			list: vi.fn().mockResolvedValue(concerts),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		order: {
			listByEvent,
			// The route calls refundCancellation(orderId); `refundCancellation`
			// below records the outcome per call so tests can make one fail.
			refundCancellation: Object.assign(
				vi.fn(async (_orderId: string) => refund()),
				{ outcome: refundCancellation },
			),
		},
	}
}

async function build(c: Clients) {
	const fixture = createFixture
		.html(
			'<artist-concerts-route component.ref="route"></artist-concerts-route>',
		)
		.deps(
			ArtistConcertsRoute,
			Registration.instance(IConcertClient, c.concert),
			Registration.instance(IOrderClient, c.order),
		)
		.build()
	await fixture.started
	const vm = (
		fixture.component as {
			route: InstanceType<typeof ArtistConcertsRoute>
		}
	).route
	// Open the screen for the Artist as the router would, then load again.
	vm.loading({ artistId: ARTIST_ID }, {
		queryParams: new URLSearchParams('name=E2E%20Test%20Artist'),
	} as never)
	c.concert.list.mockClear()
	await vm.load()
	await fixture.tasksSettled
	return { fixture, vm }
}

const rowText = (fixture: Awaited<ReturnType<typeof build>>['fixture']) =>
	fixture.appHost.querySelector('.artist-concerts-row')?.textContent ?? ''

const button = (
	fixture: Awaited<ReturnType<typeof build>>['fixture'],
	action: string,
) =>
	fixture.appHost.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)

describe('ArtistConcertsRoute', () => {
	// jsdom implements neither showModal nor close; model them so the dialog's
	// open state and its close event (Escape included) can be asserted.
	const proto = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
	const original = { showModal: proto.showModal, close: proto.close }

	beforeEach(() => {
		vi.clearAllMocks()
		proto.showModal = function (this: HTMLDialogElement) {
			this.setAttribute('open', '')
		}
		proto.close = function (this: HTMLDialogElement) {
			if (!this.hasAttribute('open')) return
			this.removeAttribute('open')
			this.dispatchEvent(new Event('close'))
		}
	})

	afterEach(() => {
		proto.showModal = original.showModal
		proto.close = original.close
	})

	describe('list', () => {
		it(`@spec ${SPEC} "Cancelled concert with paid orders"`, async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[[paid('o1', 3000), paid('o2', 5000), refunded('o3')]],
			)
			const { fixture } = await build(c)

			expect(c.concert.list).toHaveBeenCalledWith(ARTIST_ID)
			expect(c.order.listByEvent).toHaveBeenCalledWith('e1')
			expect(fixture.appHost.querySelector('h1')?.textContent).toContain(
				'E2E Test Artist',
			)
			const text = rowText(fixture)
			expect(text).toContain('Cancelled')
			expect(text).toContain('2 Paid Orders')
			expect(text).toContain('8,000 yen')
			expect(text).toContain('2026-11-20')
			expect(text).toContain('Test Tour')
			expect(text).toContain('Zepp Haneda')
		})

		it(`@spec ${SPEC} "No concerts"`, async () => {
			const { fixture } = await build(clients([]))

			expect(fixture.appHost.textContent).toContain('No concerts.')
			// The name from the roster link still heads the screen.
			expect(fixture.appHost.querySelector('h1')?.textContent).toContain(
				'E2E Test Artist',
			)
		})

		it('shows a discovered concert without orders', async () => {
			const c = clients([concert('e1', PublishState.UNSPECIFIED, false)])
			const { fixture } = await build(c)

			expect(rowText(fixture)).toContain('Discovered')
			expect(rowText(fixture)).not.toContain('Paid Orders')
			expect(c.order.listByEvent).not.toHaveBeenCalled()
		})
	})

	describe('refund all', () => {
		it(`@spec ${SPEC} "All refunded"`, async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[
					[paid('o1'), paid('o2')],
					[refunded('o1'), paid('o2')],
					[refunded('o1'), refunded('o2')],
				],
			)
			const { fixture, vm } = await build(c)

			button(fixture, 'refund-all')?.click()
			await fixture.tasksSettled
			expect(fixture.appHost.textContent).toContain('2 paid orders, 6,000 yen')
			expect(fixture.appHost.textContent).toContain('中止 (cancellation)')
			await vm.confirmRefundAll()
			await fixture.tasksSettled

			expect(c.order.refundCancellation).toHaveBeenCalledTimes(2)
			expect(c.order.refundCancellation).toHaveBeenNthCalledWith(1, 'o1')
			expect(c.order.refundCancellation).toHaveBeenNthCalledWith(2, 'o2')
			// The Orders are read again after every call (after the two loads).
			expect(c.order.listByEvent).toHaveBeenCalledTimes(4)
			expect(rowText(fixture)).toContain('0 Paid Orders')
			expect(button(fixture, 'refund-all')).toBeNull()
		})

		it(`@spec ${SPEC} "Refund stops part-way"`, async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[
					[paid('o1'), paid('o2'), paid('o3')],
					[refunded('o1'), paid('o2'), paid('o3')],
					[refunded('o1'), paid('o2'), paid('o3')],
				],
			)
			;(
				c.order.refundCancellation as unknown as {
					outcome: ReturnType<typeof vi.fn>
				}
			).outcome
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new ConnectError('down', Code.Unavailable))
			const { fixture, vm } = await build(c)

			vm.requestRefundAll(vm.rows[0])
			await vm.confirmRefundAll()
			await fixture.tasksSettled

			expect(c.order.refundCancellation).toHaveBeenCalledTimes(2)
			expect(c.order.refundCancellation).not.toHaveBeenCalledWith('o3')
			expect(fixture.appHost.textContent).toContain(
				'Refunded 1 of 3 orders. Try again to refund the rest.',
			)
			expect(rowText(fixture)).toContain('2 Paid Orders')
		})

		it(`@spec ${SPEC} "Published concert"`, async () => {
			const c = clients([concert('e1', PublishState.PUBLISHED)], [[paid('o1')]])
			const { fixture } = await build(c)

			expect(rowText(fixture)).toContain('Published')
			expect(rowText(fixture)).toContain('1 Paid Orders')
			expect(button(fixture, 'refund-all')).toBeNull()
		})

		it(`@spec ${SPEC} "Dismissed"`, async () => {
			const c = clients([concert('e1', PublishState.CANCELLED)], [[paid('o1')]])
			const { fixture, vm } = await build(c)

			button(fixture, 'refund-all')?.click()
			await fixture.tasksSettled
			expect(vm.refundDialog?.hasAttribute('open')).toBe(true)
			expect(document.activeElement).toBe(vm.refundCancelButton)

			// Escape closes a modal dialog, which fires its close event.
			vm.refundDialog?.close()
			await vm.confirmRefundAll()

			expect(vm.refundDialog?.hasAttribute('open')).toBe(false)
			expect(c.order.refundCancellation).not.toHaveBeenCalled()
		})
	})

	describe('delete', () => {
		it(`@spec ${SPEC} "Refunded cancelled concert deleted"`, async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[[refunded('o1')]],
			)
			const { fixture, vm } = await build(c)

			button(fixture, 'delete')?.click()
			await fixture.tasksSettled
			expect(document.activeElement).toBe(vm.deleteCancelButton)
			expect(vm.deleteDialog?.textContent).toContain('2026-11-20 · Test Tour')
			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(c.concert.delete).toHaveBeenCalledTimes(1)
			expect(c.concert.delete).toHaveBeenCalledWith('e1')
			expect(fixture.appHost.querySelector('.artist-concerts-row')).toBeNull()
		})

		it(`@spec ${SPEC} "Delete blocked by a paid order"`, async () => {
			// @spec stories/remove-a-cancelled-concert "Delete before refunds"
			const c = clients([concert('e1', PublishState.CANCELLED)], [[paid('o1')]])
			c.concert.delete.mockRejectedValue(
				new ConnectError(
					'an event has an order that is not refunded',
					Code.FailedPrecondition,
				),
			)
			const { fixture, vm } = await build(c)

			vm.requestDelete(vm.rows[0])
			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(vm.rows).toHaveLength(1)
			expect(fixture.appHost.textContent).toContain(DELETE_BLOCKED)
			expect(fixture.appHost.textContent).not.toContain('not refunded (')
		})

		it('shows the generic copy for any other delete failure', async () => {
			const c = clients([concert('e1', PublishState.CANCELLED)])
			c.concert.delete.mockRejectedValue(
				new ConnectError('down', Code.Unavailable),
			)
			const { fixture, vm } = await build(c)

			vm.requestDelete(vm.rows[0])
			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(vm.rows).toHaveLength(1)
			expect(fixture.appHost.textContent).toContain(
				'Failed to delete the concert.',
			)
		})

		it(`@spec ${SPEC} "Delete dismissed"`, async () => {
			const c = clients([concert('e1', PublishState.CANCELLED)])
			const { fixture, vm } = await build(c)

			button(fixture, 'delete')?.click()
			await fixture.tasksSettled
			vm.cancelDelete()
			await vm.confirmDelete()

			expect(vm.deleteDialog?.hasAttribute('open')).toBe(false)
			expect(c.concert.delete).not.toHaveBeenCalled()
		})
	})

	it(`@spec ${STORY} "Refund before cancellation"`, async () => {
		// A Concert still on sale offers no Refund all; the server refuses a
		// cancellation refund for it as well (backend OrderUseCase.Refund).
		const c = clients([concert('e1', PublishState.PUBLISHED)], [[paid('o1')]])
		const { fixture } = await build(c)

		expect(button(fixture, 'refund-all')).toBeNull()
	})
})
