import {
	type Checkout as ProtoCheckout,
	CheckoutStatus as ProtoCheckoutStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/checkout_pb.js'
import type { Order as ProtoOrder } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { Checkout, CheckoutStatus } from '../../../entities/checkout'

const STATUSES: Record<number, CheckoutStatus> = {
	[ProtoCheckoutStatus.HELD]: 'held',
	[ProtoCheckoutStatus.COMMITTED]: 'committed',
	[ProtoCheckoutStatus.COMPLETED]: 'completed',
	[ProtoCheckoutStatus.EXPIRED]: 'expired',
	[ProtoCheckoutStatus.RELEASED]: 'released',
}

/** Map a checkout with the Order it was created with (stock, count, amount). */
export function checkoutFrom(
	proto: ProtoCheckout,
	order: ProtoOrder | undefined,
): Checkout {
	return {
		id: proto.id?.value ?? '',
		orderId: proto.orderId?.value ?? '',
		ticketSaleId: proto.ticketSaleId?.value ?? '',
		ticketStockId: order?.ticketStockId?.value ?? '',
		ticketCount: order?.ticketCount ?? 0,
		amount: Number(order?.amount ?? 0),
		status: STATUSES[proto.status] ?? 'unknown',
		holdExpireTime: proto.holdExpireTime
			? timestampDate(proto.holdExpireTime)
			: new Date(0),
		commitTime: proto.commitTime ? timestampDate(proto.commitTime) : undefined,
		captureTime: proto.captureTime
			? timestampDate(proto.captureTime)
			: undefined,
	}
}
