import {
	type Reservation as ProtoReservation,
	ReservationStatus as ProtoReservationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/reservation_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	Reservation,
	ReservationStatus,
} from '../../../entities/reservation'

const STATUSES: Record<number, ReservationStatus> = {
	[ProtoReservationStatus.HELD]: 'held',
	[ProtoReservationStatus.COMMITTED]: 'committed',
	[ProtoReservationStatus.COMPLETED]: 'completed',
	[ProtoReservationStatus.EXPIRED]: 'expired',
	[ProtoReservationStatus.RELEASED]: 'released',
}

export function reservationFrom(proto: ProtoReservation): Reservation {
	return {
		id: proto.id?.value ?? '',
		ticketSaleId: proto.ticketSaleId?.value ?? '',
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
	}
}
