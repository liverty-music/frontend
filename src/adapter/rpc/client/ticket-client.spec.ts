import {
	TicketSchema,
	TicketStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import {
	type ListResponse,
	ListResponseSchema,
	TicketService as TicketServiceDef,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/ticket/v1/ticket_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { createRouterTransport } from '@connectrpc/connect'
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

function makeRouterTransport(handlers: { list?: () => ListResponse }) {
	return createRouterTransport((router) => {
		router.service(TicketServiceDef, {
			list: async (_req) =>
				handlers.list ? handlers.list() : create(ListResponseSchema),
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

	describe('list', () => {
		it('returns the account issued covered tickets', async () => {
			const transport = makeRouterTransport({
				list: () =>
					create(ListResponseSchema, {
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

			const tickets = await client.list()

			expect(tickets).toHaveLength(2)
			expect(tickets[0].id?.value).toBe('t-1')
			expect(tickets[0].status).toBe(TicketStatus.ISSUED)
			expect(tickets[1].resaleWithoutConsentProhibited).toBe(true)
		})

		it('returns empty when the caller has no tickets', async () => {
			const client = makeClient(makeRouterTransport({}))
			const tickets = await client.list()
			expect(tickets).toEqual([])
		})
	})
})
