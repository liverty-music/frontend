import {
	TicketSaleMethod,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { TicketTypeState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	EventTicketSales,
	ReferralCodeStats,
} from '../services/ticket-sale-client'
import type { DataColumn, DataRow } from '../ui/data-list/data-list'
import type { StatusTone } from '../ui/status-badge/status-badge'

export { VerificationRequirement }

export type LotteryState = 'scheduled' | 'open' | 'awaitingDraw' | 'drawn'
export type FirstComeState =
	| 'notYetOnSale'
	| 'onSale'
	| 'allHeld'
	| 'soldOut'
	| 'ended'

/** Time left until a sale opens, in whole units. */
export interface Countdown {
	days: number
	hours: number
	minutes: number
}

/** One TicketSale of an event as the Sales tab shows it. */
export interface SaleView {
	id: string
	name: string
	method: 'lottery' | 'firstCome'
	start?: Date
	end?: Date
	state: LotteryState | FirstComeState
	tone: StatusTone
	/** Catalog key of the state's label (受付開始前, 受付中, …). */
	stateKey: string
	/** Set while the sale has not opened. */
	countdown?: Countdown
	price: number
	quantity: number
	perAccountLimit: number
	verification: VerificationRequirement
	lottery?: {
		entries: number
		requested: number
		/** Requested tickets as a percentage of the quantity, when above it. */
		oversubscribedPercent?: number
		won: number
		wonTickets: number
		lost: number
	}
	firstCome?: { sold: number; held: number }
	/** A lottery changes only before it opens; a first-come sale always. */
	editable: boolean
}

const MINUTE = 60_000

export function countdownTo(start: Date, now: number): Countdown {
	const total = Math.max(0, Math.floor((start.getTime() - now) / MINUTE))
	return {
		days: Math.floor(total / (24 * 60)),
		hours: Math.floor((total % (24 * 60)) / 60),
		minutes: total % 60,
	}
}

const FIRST_COME: Record<number, { state: FirstComeState; tone: StatusTone }> =
	{
		[TicketTypeState.NOT_YET_ON_SALE]: {
			state: 'notYetOnSale',
			tone: 'warning',
		},
		[TicketTypeState.ON_SALE]: { state: 'onSale', tone: 'success' },
		[TicketTypeState.ALL_HELD]: { state: 'allHeld', tone: 'info' },
		[TicketTypeState.SOLD_OUT]: { state: 'soldOut', tone: 'neutral' },
		[TicketTypeState.ENDED]: { state: 'ended', tone: 'neutral' },
	}

const LOTTERY_TONE: Record<LotteryState, StatusTone> = {
	scheduled: 'warning',
	open: 'success',
	awaitingDraw: 'info',
	drawn: 'neutral',
}

/**
 * The event's sales in start order, each with its state at `now`. Only the
 * TicketType offered for `eventId` is read from each sale.
 */
export function saleViewsOf(
	eventId: string,
	sales: EventTicketSales,
	now: number,
): SaleView[] {
	const views = sales.ticketSales.flatMap((sale): SaleView[] => {
		const type = sale.ticketTypes.find((t) => t.eventId?.value === eventId)
		if (!type) return []
		const start = sale.saleStartTime
			? timestampDate(sale.saleStartTime)
			: undefined
		const end = sale.saleEndTime ? timestampDate(sale.saleEndTime) : undefined
		const notOpenYet = start !== undefined && now < start.getTime()
		const base = {
			id: sale.id?.value ?? '',
			name: sale.name?.value ?? '',
			start,
			end,
			price: Number(type.price?.value ?? 0),
			quantity: type.quantity ?? 0,
			perAccountLimit: type.perAccountLimit,
			verification: sale.verificationRequirement,
			countdown: notOpenYet && start ? countdownTo(start, now) : undefined,
		}

		if (sale.method === TicketSaleMethod.LOTTERY) {
			const stats = sales.lotteryEntryStats.find(
				(s) => s.ticketTypeId?.value === type.id?.value,
			)
			let state: LotteryState
			if (sale.drawTime) state = 'drawn'
			else if (notOpenYet) state = 'scheduled'
			else if (end && now >= end.getTime()) state = 'awaitingDraw'
			else state = 'open'
			const requested = stats?.ticketCount ?? 0
			return [
				{
					...base,
					method: 'lottery',
					state,
					tone: LOTTERY_TONE[state],
					stateKey: `sale.lotteryState.${state}`,
					lottery: {
						entries: stats?.entryCount ?? 0,
						requested,
						oversubscribedPercent:
							base.quantity > 0 && requested > base.quantity
								? Math.round((requested / base.quantity) * 100)
								: undefined,
						won: stats?.wonEntryCount ?? 0,
						wonTickets: stats?.wonTicketCount ?? 0,
						lost: stats?.lostEntryCount ?? 0,
					},
					editable: notOpenYet,
				},
			]
		}

		const firstCome =
			FIRST_COME[type.state] ?? FIRST_COME[TicketTypeState.ENDED]
		return [
			{
				...base,
				method: 'firstCome',
				state: firstCome.state,
				tone: firstCome.tone,
				stateKey: `sale.firstComeState.${firstCome.state}`,
				firstCome: { sold: type.soldCount ?? 0, held: type.heldCount ?? 0 },
				editable: true,
			},
		]
	})
	return views.sort(
		(a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0),
	)
}

/** The sale the lists show for an event: the open one, else the next, else the last. */
export function currentSale(views: readonly SaleView[]): SaleView | undefined {
	const open = views.find((v) => v.state === 'open' || v.state === 'onSale')
	if (open) return open
	const next = views.find((v) => v.countdown !== undefined)
	return next ?? views[views.length - 1]
}

export const VERIFICATION_OPTIONS: ReadonlyArray<{
	value: VerificationRequirement
	labelKey: string
}> = [
	{
		value: VerificationRequirement.UNSPECIFIED,
		labelKey: 'sale.verification.none',
	},
	{
		value: VerificationRequirement.VERIFIED_ANY,
		labelKey: 'sale.verification.verifiedAny',
	},
	{
		value: VerificationRequirement.JPKI_ONLY,
		labelKey: 'sale.verification.jpkiOnly',
	},
]

/** The columns of the Sales tab's purchases per referral code. */
export const REFERRAL_COLUMNS: DataColumn[] = [
	{ key: 'code', labelKey: 'sale.referral.code', primary: true },
	{ key: 'orders', labelKey: 'sale.referral.orders' },
	{ key: 'tickets', labelKey: 'sale.referral.tickets' },
	{ key: 'amount', labelKey: 'sale.referral.amount', kind: 'yen' },
]

/**
 * The event's Paid Orders per referral code as the Sales tab lists them: the
 * code as given, the number of Orders (件), their tickets (枚) and the amount
 * paid in yen 税込, in the order returned (most Orders first), with the
 * direct group (no code) moved last.
 */
export function referralRowsOf(stats: readonly ReferralCodeStats[]): DataRow[] {
	const coded = stats.filter((s) => s.code?.value)
	const direct = stats.filter((s) => !s.code?.value)
	return [...coded, ...direct].map((s) => {
		const code = s.code?.value
		return {
			id: code ?? '',
			cells: {
				code: code ?? { key: 'sale.referral.direct' },
				orders: {
					key: 'sale.referral.orderCount',
					params: { count: s.orderCount },
				},
				tickets: {
					key: 'sale.referral.ticketCount',
					params: { count: s.ticketCount },
				},
				amount: s.amount,
			},
		}
	})
}
