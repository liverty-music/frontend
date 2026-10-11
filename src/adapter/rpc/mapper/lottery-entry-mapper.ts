import {
	type LotteryEntry as ProtoLotteryEntry,
	LotteryEntryState as ProtoLotteryEntryState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_entry_pb.js'
import type {
	LotteryEntry,
	LotteryEntryState,
} from '../../../entities/lottery-entry'

const STATES: Record<number, LotteryEntryState> = {
	[ProtoLotteryEntryState.DRAFT]: 'draft',
	[ProtoLotteryEntryState.ENTERED]: 'entered',
	[ProtoLotteryEntryState.WON]: 'won',
	[ProtoLotteryEntryState.LOST]: 'lost',
	[ProtoLotteryEntryState.WITHDRAWN]: 'withdrawn',
}

/** Map a proto entry state to its domain union (unknown → `unknown`). */
export function lotteryEntryStateFrom(
	proto: ProtoLotteryEntryState,
): LotteryEntryState {
	return STATES[proto] ?? 'unknown'
}

export function lotteryEntryFrom(proto: ProtoLotteryEntry): LotteryEntry {
	return {
		id: proto.id?.value ?? '',
		ticketTypeId: proto.ticketTypeId?.value ?? '',
		requestedTicketCount: proto.requestedTicketCount,
		state: lotteryEntryStateFrom(proto.state),
	}
}
