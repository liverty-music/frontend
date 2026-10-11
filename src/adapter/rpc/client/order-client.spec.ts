import {
	OrderSchema,
	OrderStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import {
	type GetResponse,
	GetResponseSchema,
	OrderService as OrderServiceDef,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/order/v1/order_service_pb.js'
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
import { OrderRpcClient } from './order-client'

function makeClient(get: () => GetResponse) {
	vi.mocked(createTransport).mockReturnValue(
		createRouterTransport((router) => {
			router.service(OrderServiceDef, { get: async () => get() })
		}),
	)
	return new OrderRpcClient()
}

describe('OrderRpcClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns the caller order', async () => {
		const client = makeClient(() =>
			create(GetResponseSchema, {
				order: create(OrderSchema, {
					id: { value: 'order-1' },
					userId: { value: 'user-1' },
					status: OrderStatus.PAID,
					amount: BigInt(10000),
					currency: 'JPY',
				}),
			}),
		)

		const order = await client.get('order-1')

		expect(order.id?.value).toBe('order-1')
		expect(order.status).toBe(OrderStatus.PAID)
		expect(order.amount).toBe(BigInt(10000))
	})

	it('propagates NotFound (non-revealing)', async () => {
		const client = makeClient(() => {
			throw new ConnectError('order not found', Code.NotFound)
		})

		await expect(client.get('order-x')).rejects.toMatchObject({
			code: Code.NotFound,
		})
	})
})
