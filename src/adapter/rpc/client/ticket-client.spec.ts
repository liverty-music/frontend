import {
	OrderSchema,
	OrderStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import {
	TicketSchema,
	TicketStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import {
	type GetMyTicketsResponse,
	GetMyTicketsResponseSchema,
	type GetOrderResponse,
	GetOrderResponseSchema,
	TicketService as TicketServiceDef,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket/v1/ticket_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock must be hoisted; inline all DI stubs inside the factory.
vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const name = (token as { friendlyName?: string }).friendlyName ?? ''
			const fakeLogger = {
				scopeTo: (_s: string) => ({
					debug: vi.fn(),
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
				}),
			}
			if (name === 'ILogger') return fakeLogger
			if (name === 'IAuthService')
				return { getUserManager: () => ({ getUser: async () => null }) }
			if (name === 'IAppConfig')
				return { apiBaseUrl: 'https://api.test.example.com' }
			return {}
		}),
	}
})

vi.mock('../../../services/grpc-transport', () => ({
	createTransport: vi.fn(),
}))

import { createTransport } from '../../../services/grpc-transport'
import { TicketRpcClient } from './ticket-client'

function makeRouterTransport(handlers: {
	getOrder?: () => GetOrderResponse
	getMyTickets?: () => GetMyTicketsResponse
}) {
	return createRouterTransport((router) => {
		router.service(TicketServiceDef, {
			getOrder: async (_req) =>
				handlers.getOrder
					? handlers.getOrder()
					: create(GetOrderResponseSchema),
			getMyTickets: async (_req) =>
				handlers.getMyTickets
					? handlers.getMyTickets()
					: create(GetMyTicketsResponseSchema),
		})
	})
}

function makeClient(transport: ReturnType<typeof createRouterTransport>) {
	vi.mocked(createTransport).mockReturnValue(transport)
	return new TicketRpcClient()
}

describe('TicketRpcClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('getOrder', () => {
		it('happy path: returns the caller order', async () => {
			const transport = makeRouterTransport({
				getOrder: () =>
					create(GetOrderResponseSchema, {
						order: create(OrderSchema, {
							id: { value: 'order-1' },
							buyerId: { value: 'user-1' },
							status: OrderStatus.PAID,
							amount: BigInt(10000),
							currency: 'JPY',
						}),
					}),
			})
			const client = makeClient(transport)

			const order = await client.getOrder('order-1')

			expect(order.id?.value).toBe('order-1')
			expect(order.status).toBe(OrderStatus.PAID)
			expect(order.amount).toBe(BigInt(10000))
		})

		it('propagates NotFound (non-revealing)', async () => {
			const transport = makeRouterTransport({
				getOrder: () => {
					throw new ConnectError('order not found', Code.NotFound)
				},
			})
			const client = makeClient(transport)

			await expect(client.getOrder('order-x')).rejects.toMatchObject({
				code: Code.NotFound,
			})
		})
	})

	describe('getMyTickets', () => {
		it('returns the account issued covered tickets', async () => {
			const transport = makeRouterTransport({
				getMyTickets: () =>
					create(GetMyTicketsResponseSchema, {
						tickets: [
							create(TicketSchema, {
								id: { value: 't-1' },
								eventId: { value: 'event-1' },
								resaleWithoutConsentProhibited: true,
								status: TicketStatus.ISSUED,
							}),
							create(TicketSchema, {
								id: { value: 't-2' },
								eventId: { value: 'event-1' },
								resaleWithoutConsentProhibited: true,
								status: TicketStatus.ISSUED,
							}),
						],
					}),
			})
			const client = makeClient(transport)

			const tickets = await client.getMyTickets()

			expect(tickets).toHaveLength(2)
			expect(tickets[0].id?.value).toBe('t-1')
			expect(tickets[0].status).toBe(TicketStatus.ISSUED)
			expect(tickets[1].resaleWithoutConsentProhibited).toBe(true)
		})

		it('returns empty when the caller has no tickets', async () => {
			const client = makeClient(makeRouterTransport({}))
			const tickets = await client.getMyTickets()
			expect(tickets).toEqual([])
		})
	})
})
