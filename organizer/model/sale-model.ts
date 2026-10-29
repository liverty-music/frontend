import {
	TicketSaleMethod,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type {
	EventTicketSales,
	ReferralCodeStats,
} from '../services/ticket-sale-client'
import type { DataColumn, DataRow } from '../ui/data-list/data-list'
import type { StatusTone } from '../ui/status-badge/status-badge'
import type { StockView } from './stock-model'

export { VerificationRequirement }

export type LotteryState = 'scheduled' | 'open' | 'awaitingDraw' | 'drawn'
export type FirstComeState = 'scheduled' | 'open' | 'ended'

/** Time left until a sale opens, in whole units. */
export interface Countdown {
	days: number
	hours: number
	minutes: number
}

/** An open lottery's demand for one seat type of the event. */
export interface LotteryStockStats {
	/** The TicketStock the stats are for. */
	id: string
	/** The seat type's name, e.g. S席. */
	name: string
	entries: number
	requested: number
	/** The stock's tickets neither sold nor held now. */
	remaining: number
	/** Requested tickets as a percentage of the remaining ones, when above them. */
	oversubscribedPercent?: number
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
	verification: VerificationRequirement
	lottery?: {
		/** Per seat type of the event, in the order of its stocks. */
		stocks: LotteryStockStats[]
		/** Totals over every seat type, shown once the lottery is drawn. */
		won: number
		wonTickets: number
		lost: number
	}
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

const LOTTERY_TONE: Record<LotteryState, StatusTone> = {
	scheduled: 'warning',
	open: 'success',
	awaitingDraw: 'info',
	drawn: 'neutral',
}

const FIRST_COME_TONE: Record<FirstComeState, StatusTone> = {
	scheduled: 'warning',
	open: 'success',
	ended: 'neutral',
}

/**
 * The event's sales in start order, each with its state at `now`. Only the
 * sales naming `eventId` are listed. A closed lottery is drawn once none of
 * its entries is Entered: each of its stats counts as many entries as won
 * and lost ones (components/entity/ticket-sale "Drawn lottery"). An open
 * lottery's demand per seat type is compared with the remaining tickets of
 * the event's `stocks`; the sold and held tickets of a first-come sale are
 * shown per stock in 席種と枚数, not on the sale.
 */
export function saleViewsOf(
	eventId: string,
	sales: EventTicketSales,
	now: number,
	stocks: readonly StockView[] = [],
): SaleView[] {
	const views = sales.ticketSales.flatMap((sale): SaleView[] => {
		if (!sale.eventIds.some((e) => e.value === eventId)) return []
		const id = sale.id?.value ?? ''
		const start = sale.saleStartTime
			? timestampDate(sale.saleStartTime)
			: undefined
		const end = sale.saleEndTime ? timestampDate(sale.saleEndTime) : undefined
		const notOpenYet = start !== undefined && now < start.getTime()
		const closed = end !== undefined && now >= end.getTime()
		const base = {
			id,
			name: sale.name?.value ?? '',
			start,
			end,
			verification: sale.verificationRequirement,
			countdown: notOpenYet && start ? countdownTo(start, now) : undefined,
		}

		if (sale.method === TicketSaleMethod.LOTTERY) {
			const stats = sales.lotteryEntryStats.filter(
				(s) => s.ticketSaleId?.value === id,
			)
			const drawn =
				closed &&
				stats.every((s) => s.entryCount === s.wonEntryCount + s.lostEntryCount)
			let state: LotteryState
			if (notOpenYet) state = 'scheduled'
			else if (drawn) state = 'drawn'
			else if (closed) state = 'awaitingDraw'
			else state = 'open'
			return [
				{
					...base,
					method: 'lottery',
					state,
					tone: LOTTERY_TONE[state],
					stateKey: `sale.lotteryState.${state}`,
					lottery: {
						stocks: stocks.map((stock) => {
							const s = stats.find((x) => x.ticketStockId?.value === stock.id)
							const requested = s?.ticketCount ?? 0
							return {
								id: stock.id,
								name: stock.name,
								entries: s?.entryCount ?? 0,
								requested,
								remaining: stock.remaining,
								oversubscribedPercent:
									requested > stock.remaining && stock.remaining > 0
										? Math.round((requested / stock.remaining) * 100)
										: undefined,
							}
						}),
						won: sum(stats.map((s) => s.wonEntryCount)),
						wonTickets: sum(stats.map((s) => s.wonTicketCount)),
						lost: sum(stats.map((s) => s.lostEntryCount)),
					},
					editable: notOpenYet,
				},
			]
		}

		const state: FirstComeState = notOpenYet
			? 'scheduled'
			: closed
				? 'ended'
				: 'open'
		return [
			{
				...base,
				method: 'firstCome',
				state,
				tone: FIRST_COME_TONE[state],
				stateKey: `sale.firstComeState.${state}`,
				editable: true,
			},
		]
	})
	return views.sort(
		(a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0),
	)
}

function sum(values: readonly number[]): number {
	return values.reduce((a, b) => a + b, 0)
}

/** The sale the lists show for an event: the open one, else the next, else the last. */
export function currentSale(views: readonly SaleView[]): SaleView | undefined {
	const open = views.find((v) => v.state === 'open')
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
