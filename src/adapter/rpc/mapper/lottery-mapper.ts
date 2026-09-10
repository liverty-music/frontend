import {
	type TicketApplication as ProtoTicketApplication,
	TicketApplicationState as ProtoTicketApplicationState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/lottery_application_pb.js'
import type {
	TicketApplication,
	TicketApplicationState,
} from '../../../entities/lottery'

const protoToState: Record<number, TicketApplicationState> = {
	[ProtoTicketApplicationState.UNSPECIFIED]: 'unspecified',
	[ProtoTicketApplicationState.APPLIED]: 'applied',
	[ProtoTicketApplicationState.WON]: 'won',
	[ProtoTicketApplicationState.LOST]: 'lost',
	[ProtoTicketApplicationState.WITHDRAWN]: 'withdrawn',
}

/** Map a proto application state to its domain union (unknown → `unspecified`). */
export function ticketApplicationStateFrom(
	proto: ProtoTicketApplicationState,
): TicketApplicationState {
	return protoToState[proto] ?? 'unspecified'
}

/**
 * Map a proto `TicketApplication` to the domain entity, carrying only the fields
 * the fan-facing my-application / result view reads (count, 本人確認, state).
 */
export function ticketApplicationFrom(
	proto: ProtoTicketApplication,
): TicketApplication {
	return {
		requestedTicketCount: proto.requestedTicketCount,
		identity: {
			fullName: proto.identity?.fullName ?? '',
			phoneNumber: proto.identity?.phoneNumber ?? '',
		},
		state: ticketApplicationStateFrom(proto.state),
	}
}
