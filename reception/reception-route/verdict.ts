import { RejectedScanReason } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/rejected_scan_pb.js'
import type { AdmitResponse } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import {
	formatJstTime,
	receptionLinkLabel,
} from '../../shared/lib/reception/jst-format'

/**
 * - `ok`: every presented ticket admitted.
 * - `partial`: some admitted, the rest refused.
 * - `ng`: nobody admitted.
 * - `undecided`: the server could not be reached; nobody may be let in yet.
 */
export type VerdictTone = 'ok' | 'partial' | 'ng' | 'undecided'

/** Why some people of a scan are refused, and what staff do about it. */
export interface VerdictReason {
	/** How many presented tickets this reason covers (1 for a whole-scan reason). */
	readonly count: number
	readonly reason: string
	/** The earlier admission for an already-used ticket, e.g. `18:32 受付1`. */
	readonly detail: string
	readonly nextStep: string
}

/** What the reception screen shows after a scan. It carries no personal data. */
export interface Verdict {
	readonly tone: VerdictTone
	/** `OK`, `NG` or the undecided headline. */
	readonly headline: string
	/** How many to let in; 0 for NG and undecided. */
	readonly admittedCount: number
	/** `3名`, or empty when nobody is let in. */
	readonly admittedLabel: string
	readonly reasons: readonly VerdictReason[]
}

interface ReasonCopy {
	readonly reason: string
	readonly nextStep: string
}

const COPY: Record<
	Exclude<RejectedScanReason, RejectedScanReason.UNSPECIFIED>,
	ReasonCopy
> = {
	[RejectedScanReason.FORGED]: {
		reason: '有効な入場QRコードではありません',
		nextStep:
			'登録したスマートフォンのチケット画面から、QRコードを表示してもらってください。',
	},
	[RejectedScanReason.EXPIRED]: {
		reason: 'QRコードの有効期限切れです',
		nextStep: 'チケット画面のQRコードを開き直してもらってください。',
	},
	[RejectedScanReason.OTHER_EVENT]: {
		reason: '別の公演のチケットです',
		nextStep: 'この公演のチケットか確認してもらってください。',
	},
	[RejectedScanReason.NOT_HOLDER]: {
		reason: '本人のチケットではありません',
		nextStep:
			'チケットを持っている本人のスマートフォンから、QRコードを表示してもらってください。',
	},
	[RejectedScanReason.VOIDED]: {
		reason: '無効なチケットです（払い戻し・リセール済み）',
		nextStep: 'このチケットでは入場できません。主催者に確認してください。',
	},
	[RejectedScanReason.ALREADY_ADMITTED]: {
		reason: '使用済みです',
		nextStep: 'このチケットはすでに入場済みです。主催者に確認してください。',
	},
}

const UNKNOWN_COPY: ReasonCopy = {
	reason: '入場できません',
	nextStep: '主催者に確認してください。',
}

function copyFor(reason: RejectedScanReason): ReasonCopy {
	return reason === RejectedScanReason.UNSPECIFIED ? UNKNOWN_COPY : COPY[reason]
}

/** The verdict for one decided scan. */
export function toVerdict(response: AdmitResponse): Verdict {
	const admitted = response.admittedTicketCount
	const reasons: VerdictReason[] = []

	if (response.rejectedScanReason !== RejectedScanReason.UNSPECIFIED) {
		reasons.push({
			count: 1,
			detail: '',
			...copyFor(response.rejectedScanReason),
		})
	}

	// One line per distinct reason (and, for already-used tickets, per earlier
	// admission), in the order the code presents the tickets.
	const lines = new Map<string, VerdictReason>()
	for (const ticket of response.rejectedTickets) {
		const parts: string[] = []
		if (ticket.earlierAdmitTime) {
			parts.push(formatJstTime(timestampDate(ticket.earlierAdmitTime)))
		}
		if (ticket.earlierReceptionLinkNumber) {
			parts.push(receptionLinkLabel(ticket.earlierReceptionLinkNumber.value))
		}
		const detail = parts.join(' ')
		const key = `${ticket.reason}|${detail}`
		const line = lines.get(key)
		lines.set(
			key,
			line
				? { ...line, count: line.count + 1 }
				: { count: 1, detail, ...copyFor(ticket.reason) },
		)
	}
	reasons.push(...lines.values())

	const tone: VerdictTone =
		admitted === 0 ? 'ng' : reasons.length > 0 ? 'partial' : 'ok'
	return {
		tone,
		headline: admitted > 0 ? 'OK' : 'NG',
		admittedCount: admitted,
		admittedLabel: admitted > 0 ? `${admitted}名` : '',
		reasons,
	}
}

/** The verdict when the scan could not be decided: never OK. */
export function undecidedVerdict(): Verdict {
	return {
		tone: 'undecided',
		headline: '判定できませんでした',
		admittedCount: 0,
		admittedLabel: '',
		reasons: [
			{
				count: 1,
				reason: 'サーバーに接続できませんでした',
				detail: '',
				nextStep: 'まだ入場させずに、もう一度スキャンしてください。',
			},
		],
	}
}
