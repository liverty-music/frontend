import {
	type LotteryEntry as ProtoLotteryEntry,
	LotteryEntryState as ProtoLotteryEntryState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_entry_pb.js'
import type { Order as ProtoOrder } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import type {
	LotteryEntry,
	LotteryEntryState,
} from '../../../entities/lottery-entry'

const STATES: Record<number, LotteryEntryState> = {
	[ProtoLotteryEntryState.ENTERED]: 'entered',
	[ProtoLotteryEntryState.WON]: 'won',
	[ProtoLotteryEntryState.LOST]: 'lost',
}

/** Map a proto entry state to its domain union (unknown → `unknown`). */
export function lotteryEntryStateFrom(
	proto: ProtoLotteryEntryState,
): LotteryEntryState {
	return STATES[proto] ?? 'unknown'
}

/** Map an entry with the Order it was created with (stock and count). */
export function lotteryEntryFrom(
	proto: ProtoLotteryEntry,
	order: ProtoOrder | undefined,
): LotteryEntry {
	return {
		id: proto.id?.value ?? '',
		orderId: proto.orderId?.value ?? '',
		ticketSaleId: proto.ticketSaleId?.value ?? '',
		ticketStockId: order?.ticketStockId?.value ?? '',
		ticketCount: order?.ticketCount ?? 0,
		state: lotteryEntryStateFrom(proto.state),
	}
}

/** Map entries, each joined with its Order from `orders` by the entry's Order id. */
export function lotteryEntriesFrom(
	entries: readonly ProtoLotteryEntry[],
	orders: readonly ProtoOrder[],
): LotteryEntry[] {
	const byId = new Map(
		orders.flatMap((o) => (o.id ? [[o.id.value, o] as const] : [])),
	)
	return entries.map((e) =>
		lotteryEntryFrom(e, byId.get(e.orderId?.value ?? '')),
	)
}
