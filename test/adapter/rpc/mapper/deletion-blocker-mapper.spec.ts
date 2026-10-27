import {
	DeletionBlocker_Kind,
	DeletionBlockerSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/deletion_blocker_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { deletionBlockersFrom } from '../../../../src/adapter/rpc/mapper/deletion-blocker-mapper'

describe('deletionBlockersFrom', () => {
	it('maps every kind with its count, and an unknown kind to other', () => {
		const blockers = [
			DeletionBlocker_Kind.UPCOMING_TICKET,
			DeletionBlocker_Kind.LISTED_RESALE,
			DeletionBlocker_Kind.PENDING_LOTTERY_ENTRY,
			DeletionBlocker_Kind.PAYMENT_IN_PROGRESS,
			DeletionBlocker_Kind.UNSPECIFIED,
		].map((kind, i) => create(DeletionBlockerSchema, { kind, count: i + 1 }))

		expect(deletionBlockersFrom(blockers)).toEqual([
			{ kind: 'upcomingTicket', count: 1 },
			{ kind: 'listedResale', count: 2 },
			{ kind: 'pendingLotteryEntry', count: 3 },
			{ kind: 'paymentInProgress', count: 4 },
			{ kind: 'other', count: 5 },
		])
	})
})
