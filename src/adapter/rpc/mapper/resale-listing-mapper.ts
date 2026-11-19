import {
	type ResaleListing as ProtoResaleListing,
	ResaleListingStatus as ProtoResaleListingStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/resale_listing_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	ResaleListing,
	ResaleListingStatus,
} from '../../../entities/resale-listing'

const STATUSES: Record<number, ResaleListingStatus> = {
	[ProtoResaleListingStatus.LISTED]: 'listed',
	[ProtoResaleListingStatus.SOLD]: 'sold',
	[ProtoResaleListingStatus.WITHDRAWN]: 'withdrawn',
	[ProtoResaleListingStatus.CANCELLED]: 'cancelled',
	[ProtoResaleListingStatus.EXPIRED]: 'expired',
}

export function resaleListingFrom(proto: ProtoResaleListing): ResaleListing {
	return {
		id: proto.id?.value ?? '',
		ticketId: proto.ticketId?.value ?? '',
		ticketStockId: proto.ticketStockId?.value ?? '',
		price: Number(proto.price?.value ?? 0),
		fee: Number(proto.fee),
		refundAmount: Number(proto.refundAmount),
		status: STATUSES[proto.status] ?? 'unknown',
		createTime: proto.createTime
			? timestampDate(proto.createTime)
			: new Date(0),
		closeTime: proto.closeTime ? timestampDate(proto.closeTime) : new Date(0),
		sellTime: proto.sellTime ? timestampDate(proto.sellTime) : undefined,
		refundTime: proto.refundTime ? timestampDate(proto.refundTime) : undefined,
	}
}
