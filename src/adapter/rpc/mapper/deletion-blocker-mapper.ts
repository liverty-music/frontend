import {
	DeletionBlocker_Kind,
	type DeletionBlocker as ProtoDeletionBlocker,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/deletion_blocker_pb.js'
import type {
	DeletionBlocker,
	DeletionBlockerKind,
} from '../../../entities/deletion-blocker'

const KINDS: Partial<Record<DeletionBlocker_Kind, DeletionBlockerKind>> = {
	[DeletionBlocker_Kind.UPCOMING_TICKET]: 'upcomingTicket',
	[DeletionBlocker_Kind.LISTED_RESALE]: 'listedResale',
	[DeletionBlocker_Kind.PENDING_LOTTERY_ENTRY]: 'pendingLotteryEntry',
	[DeletionBlocker_Kind.PAYMENT_IN_PROGRESS]: 'paymentInProgress',
}

/** Map the wire blockers; a kind this app does not know is kept as `other`. */
export function deletionBlockersFrom(
	blockers: readonly ProtoDeletionBlocker[],
): DeletionBlocker[] {
	return blockers.map((b) => ({
		kind: KINDS[b.kind] ?? 'other',
		count: b.count,
	}))
}
