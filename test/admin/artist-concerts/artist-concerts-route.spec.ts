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

// The route resolves IArtistClient, IConcertClient and IOrderClient. Replace
// the real modules (which would build Connect transports) with fresh interface
// tokens so the fixture binds to the test doubles.
const IArtistClient = DI.createInterface('IArtistClient')
const IConcertClient = DI.createInterface('IConcertClient')
const IOrderClient = DI.createInterface('IOrderClient')

vi.mock('../../../admin/services/artist-client', () => ({ IArtistClient }))
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
	artist: { get: ReturnType<typeof vi.fn> }
	concert: {
		listByArtist: ReturnType<typeof vi.fn>
		delete: ReturnType<typeof vi.fn>
	}
	order: {
		listByEvent: ReturnType<typeof vi.fn>
		refundCancellation: ReturnType<typeof vi.fn>
	}
}

/**
 * Test doubles. `orders[n]` is what ListByEvent returns once n refunds have
 * succeeded, so every re-read sees the Orders the refunds so far left. With
 * `failAt`, the refund call of that number (1-based) fails with Unavailable.
 */
function clients(
	concerts: ResolvedConcert[],
	orders: Order[][] = [[]],
	{ failAt }: { failAt?: number } = {},
): Clients {
	let calls = 0
	let succeeded = 0
	return {
		artist: {
			get: vi.fn().mockResolvedValue(
				create(ArtistSchema, {
					id: { value: ARTIST_ID },
					name: { value: 'E2E Test Artist' },
				}),
			),
		},
		concert: {
			listByArtist: vi.fn().mockResolvedValue(concerts),
			delete: vi.fn().mockResolvedValue(undefined),
		},
		order: {
			listByEvent: vi.fn(async () =>
				structuredClone(orders[Math.min(succeeded, orders.length - 1)] ?? []),
			),
			refundCancellation: vi.fn(async (_orderId: string) => {
				calls++
				if (calls === failAt) throw new ConnectError('down', Code.Unavailable)
				succeeded++
			}),
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
			Registration.instance(IArtistClient, c.artist),
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
	// Load for the Artist; the loading hook does the same with the route params.
	vm.artistId = ARTIST_ID
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

			expect(c.concert.listByArtist).toHaveBeenCalledWith(
				ARTIST_ID,
				expect.any(AbortSignal),
			)
			expect(c.order.listByEvent).toHaveBeenCalledWith(
				'e1',
				expect.any(AbortSignal),
			)
			expect(fixture.appHost.querySelector('h1')?.textContent).toContain(
				'E2E Test Artist',
			)
			// The Paid Orders render after their own read; wait for them.
			await vi.waitFor(() => expect(rowText(fixture)).toContain('8,000 yen'))
			const text = rowText(fixture)
			expect(text).toContain('Cancelled')
			expect(text).toContain('2 Paid Orders')
			expect(text).toContain('2026-11-20')
			expect(text).toContain('Test Tour')
			expect(text).toContain('Zepp Haneda')
		})

		it(`@spec ${SPEC} "No concerts"`, async () => {
			const { fixture } = await build(clients([]))

			expect(fixture.appHost.textContent).toContain('No concerts.')
			// The name read with ArtistService.Get heads the screen.
			expect(fixture.appHost.querySelector('h1')?.textContent).toContain(
				'E2E Test Artist',
			)
		})

		it(`@spec ${SPEC} "Unknown artist"`, async () => {
			const c = clients([])
			c.artist.get.mockResolvedValue(null)
			const { fixture } = await build(c)

			expect(fixture.appHost.textContent).toContain('No artist has this id.')
			expect(fixture.appHost.querySelector('.artist-concerts-row')).toBeNull()
			// Retrying cannot make the Artist exist.
			expect(fixture.appHost.textContent).not.toContain('Retry')
		})

		it('loads for the route params on every activation', async () => {
			const c = clients([])
			const { vm } = await build(c)
			c.artist.get.mockClear()
			c.concert.listByArtist.mockClear()

			vm.loading({ artistId: 'artist-2' })
			await vi.waitFor(() => expect(vm.phase).toBe('ready'))

			expect(c.artist.get).toHaveBeenCalledWith(
				'artist-2',
				expect.any(AbortSignal),
			)
			expect(c.concert.listByArtist).toHaveBeenCalledWith(
				'artist-2',
				expect.any(AbortSignal),
			)
		})

		it('aborts the reads of a load a newer load supersedes', async () => {
			const c = clients([])
			const { vm } = await build(c)

			const first = vm.load()
			const [, firstSignal] = c.concert.listByArtist.mock.calls.at(-1) ?? []
			await vm.load()
			await first

			expect((firstSignal as AbortSignal).aborted).toBe(true)
			expect(vm.phase).toBe('ready')
		})

		it('keeps the artist name when its concerts fail to load', async () => {
			const c = clients([])
			c.concert.listByArtist.mockRejectedValue(
				new ConnectError('down', Code.Unavailable),
			)
			const { fixture, vm } = await build(c)

			expect(vm.phase).toBe('error')
			expect(fixture.appHost.querySelector('h1')?.textContent).toContain(
				'E2E Test Artist',
			)
			expect(fixture.appHost.textContent).toContain('Retry')
		})

		it('shows no order counts when the orders fail to load', async () => {
			const c = clients([concert('e1', PublishState.CANCELLED)])
			c.order.listByEvent.mockRejectedValue(
				new ConnectError('down', Code.Unavailable),
			)
			const { fixture } = await build(c)

			await vi.waitFor(() =>
				expect(rowText(fixture)).toContain('Failed to load the orders.'),
			)
			expect(rowText(fixture)).not.toContain('Paid Orders')
			expect(button(fixture, 'refund-all')).toBeNull()
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
			// The Orders are read once on load and again after every call.
			expect(c.order.listByEvent).toHaveBeenCalledTimes(3)
			await vi.waitFor(() =>
				expect(rowText(fixture)).toContain('0 Paid Orders'),
			)
			expect(button(fixture, 'refund-all')).toBeNull()
		})

		it('shows how many refunds are done while it runs', async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[
					[paid('o1'), paid('o2')],
					[refunded('o1'), paid('o2')],
				],
			)
			const gates: (() => void)[] = []
			const refund = c.order.refundCancellation.getMockImplementation()
			c.order.refundCancellation.mockImplementation(async (id: string) => {
				await new Promise<void>((resolve) => gates.push(resolve))
				return refund?.(id)
			})
			const { fixture, vm } = await build(c)

			button(fixture, 'refund-all')?.click()
			const run = vm.confirmRefundAll()
			await vi.waitFor(() => expect(gates).toHaveLength(1))
			await vi.waitFor(() =>
				expect(rowText(fixture)).toContain('Refunding… 0 of 2 done'),
			)
			gates[0]()
			await vi.waitFor(() => expect(gates).toHaveLength(2))
			await vi.waitFor(() =>
				expect(rowText(fixture)).toContain('Refunding… 1 of 2 done'),
			)
			gates[1]()
			await run
		})

		it(`@spec ${SPEC} "Refund stops part-way"`, async () => {
			const c = clients(
				[concert('e1', PublishState.CANCELLED)],
				[
					[paid('o1'), paid('o2'), paid('o3')],
					[refunded('o1'), paid('o2'), paid('o3')],
				],
				{ failAt: 2 },
			)
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
				new ConnectError('an event has a paid order', Code.FailedPrecondition),
			)
			const { fixture, vm } = await build(c)

			vm.requestDelete(vm.rows[0])
			await vm.confirmDelete()
			await fixture.tasksSettled

			expect(vm.rows).toHaveLength(1)
			expect(fixture.appHost.textContent).toContain(DELETE_BLOCKED)
			expect(fixture.appHost.textContent).not.toContain('an event has')
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
