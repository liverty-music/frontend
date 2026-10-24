import { RefundReason } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/order/v1/order_service_pb.js'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'

const mockRpc = { listByEvent: vi.fn(), refund: vi.fn() }

vi.mock('@connectrpc/connect', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@connectrpc/connect')>()
	return { ...actual, createClient: vi.fn().mockReturnValue(mockRpc) }
})

const mockCreateAdminTransport = vi.fn().mockReturnValue({})
vi.mock('../../../admin/services/admin-transport', () => ({
	createAdminTransport: mockCreateAdminTransport,
}))

const { IAppConfig } = await import('../../../shared/config/app-config')
const { IAuthService } = await import('../../../shared/services/auth-service')
const { IOrderClient } = await import('../../../admin/services/order-client')

function resolveClient() {
	const container = DI.createContainer()
	container.register(
		Registration.instance(IAppConfig, createMockAppConfig()),
		Registration.instance(IAuthService, createMockAuth() as never),
		IOrderClient,
	)
	return container.get(IOrderClient)
}

describe('OrderClient', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('uses the authenticated admin transport', () => {
		resolveClient()
		expect(mockCreateAdminTransport).toHaveBeenCalledTimes(1)
	})

	it('listByEvent wraps the event id and returns the orders', async () => {
		mockRpc.listByEvent.mockResolvedValue({ orders: [{ id: { value: 'o1' } }] })
		const client = resolveClient()

		const orders = await client.listByEvent('e1')

		const [req] = mockRpc.listByEvent.mock.calls.at(-1) ?? []
		expect(req.eventId?.value).toBe('e1')
		expect(orders).toHaveLength(1)
	})

	it('refundCancellation refunds the order for cancellation', async () => {
		mockRpc.refund.mockResolvedValue({})
		const client = resolveClient()

		await client.refundCancellation('o1')

		const [req] = mockRpc.refund.mock.calls.at(-1) ?? []
		expect(req.orderId?.value).toBe('o1')
		expect(req.reason).toBe(RefundReason.CANCELLATION)
	})

	it('propagates refund errors', async () => {
		mockRpc.refund.mockRejectedValue(new Error('not cancelled'))
		const client = resolveClient()

		await expect(client.refundCancellation('o1')).rejects.toThrow(
			'not cancelled',
		)
	})
})
