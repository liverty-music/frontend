import type { Order } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { OrderService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/order/v1/order_service_pb.js'
import { type Client, createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IOrderRpcClient = DI.createInterface<IOrderRpcClient>(
	'IOrderRpcClient',
	(x) => x.singleton(OrderRpcClient),
)

export interface IOrderRpcClient extends OrderRpcClient {}

/** The signed-in fan's own Orders (`OrderService`): their payment results. */
export class OrderRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('OrderRpcClient')
	private readonly client: Client<typeof OrderService> = createClient(
		OrderService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * One of the caller's own Orders. Throws a ConnectError with Code.NotFound
	 * when the order is not the caller's (non-revealing).
	 */
	public async get(orderId: string, signal?: AbortSignal): Promise<Order> {
		this.logger.info('Getting order', { orderId })
		try {
			const response = await this.client.get(
				{ orderId: { value: orderId } },
				{ signal },
			)
			if (!response.order) throw new Error('Get returned no order')
			return response.order
		} catch (err) {
			this.logger.warn('Order get failed', { orderId, error: err })
			throw err
		}
	}
}
