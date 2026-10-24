import type { Order } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import {
	OrderService,
	RefundReason,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/order/v1/order_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Order }

export const IOrderClient = DI.createInterface<IOrderClient>(
	'IOrderClient',
	(x) => x.singleton(OrderClient),
)

export interface IOrderClient extends OrderClient {}

/**
 * Admin-local wrapper around the generated admin `OrderService` client: an
 * Event's Orders, and the cancellation refund of one Order. Mirrors
 * {@link ConcertClient}; errors propagate so the route can map their codes to
 * copy. Served by the admin Connect server through {@link createAdminTransport}.
 */
export class OrderClient {
	private readonly logger = resolve(ILogger).scopeTo('OrderClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		OrderService,
		createAdminTransport(
			this.authService,
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/** Returns every Order of the event, in any status, oldest pay time first. */
	public async listByEvent(
		eventId: string,
		signal?: AbortSignal,
	): Promise<Order[]> {
		this.logger.info('Listing event orders', { eventId })
		try {
			const response = await this.client.listByEvent(
				{ eventId: { value: eventId } },
				{ signal },
			)
			return response.orders
		} catch (err) {
			this.logger.warn('listByEvent failed', { eventId, error: err })
			throw err
		}
	}

	/**
	 * Refunds the Order for 中止 (cancellation). The server accepts it only
	 * while the Order's Event is CANCELLED, and a repeated call refunds once.
	 */
	public async refundCancellation(
		orderId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Refunding order for cancellation', { orderId })
		try {
			await this.client.refund(
				{ orderId: { value: orderId }, reason: RefundReason.CANCELLATION },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('refund failed', { orderId, error: err })
			throw err
		}
	}
}
