import {
	type Checkout as ProtoCheckout,
	CheckoutStatus as ProtoCheckoutStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/checkout_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { Checkout, CheckoutStatus } from '../../../entities/checkout'

const STATUSES: Record<number, CheckoutStatus> = {
	[ProtoCheckoutStatus.HELD]: 'held',
	[ProtoCheckoutStatus.COMMITTED]: 'committed',
	[ProtoCheckoutStatus.COMPLETED]: 'completed',
	[ProtoCheckoutStatus.EXPIRED]: 'expired',
	[ProtoCheckoutStatus.RELEASED]: 'released',
}

export function checkoutFrom(proto: ProtoCheckout): Checkout {
	return {
		id: proto.id?.value ?? '',
		ticketTypeId: proto.ticketTypeId?.value ?? '',
		ticketCount: proto.ticketCount,
		amount: Number(proto.amount),
		status: STATUSES[proto.status] ?? 'unknown',
		holdExpireTime: proto.holdExpireTime
			? timestampDate(proto.holdExpireTime)
			: new Date(0),
		commitTime: proto.commitTime ? timestampDate(proto.commitTime) : undefined,
		captureTime: proto.captureTime
			? timestampDate(proto.captureTime)
			: undefined,
		resale: proto.resale,
	}
}
