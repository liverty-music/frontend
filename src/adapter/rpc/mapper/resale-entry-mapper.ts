import {
	type ResaleEntry as ProtoResaleEntry,
	ResaleEntryState as ProtoResaleEntryState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/resale_entry_pb.js'
import type { Order as ProtoOrder } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	ResaleEntry,
	ResaleEntryState,
} from '../../../entities/resale-entry'

const STATES: Record<number, ResaleEntryState> = {
	[ProtoResaleEntryState.ENTERED]: 'entered',
	[ProtoResaleEntryState.WON]: 'won',
	[ProtoResaleEntryState.LOST]: 'lost',
	[ProtoResaleEntryState.LAPSED]: 'lapsed',
	[ProtoResaleEntryState.WITHDRAWN]: 'withdrawn',
}

/** Map an entry with its Order (stock and count). */
export function resaleEntryFrom(
	proto: ProtoResaleEntry,
	order: ProtoOrder | undefined,
): ResaleEntry {
	return {
		id: proto.id?.value ?? '',
		orderId: proto.orderId?.value ?? '',
		ticketStockId: order?.ticketStockId?.value ?? '',
		ticketCount: order?.ticketCount ?? 0,
		state: STATES[proto.state] ?? 'unknown',
		createTime: proto.createTime
			? timestampDate(proto.createTime)
			: new Date(0),
		nextDrawTime: proto.nextDrawTime
			? timestampDate(proto.nextDrawTime)
			: undefined,
	}
}

/** Map entries, each joined with its Order from `orders` by the entry's Order id. */
export function resaleEntriesFrom(
	entries: readonly ProtoResaleEntry[],
	orders: readonly ProtoOrder[],
): ResaleEntry[] {
	const byId = new Map(
		orders.flatMap((o) => (o.id ? [[o.id.value, o] as const] : [])),
	)
	return entries.map((e) =>
		resaleEntryFrom(e, byId.get(e.orderId?.value ?? '')),
	)
}
