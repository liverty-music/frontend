import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { OrganizerSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { SeatTypeSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	type TicketSale,
	TicketSaleMethod,
	TicketSaleSchema,
	VerificationRequirement,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import {
	TicketStockSchema,
	TicketStockState,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_stock_pb.js'
import { LotteryEntryStatsSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/ticket_sale/v1/ticket_sale_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { vi } from 'vitest'
import type { EventTicketStocks } from '../../../organizer/services/ticket-stock-client'
import { authoredSeries } from '../authored-series'

/**
 * Builders and queries shared by the tests of the event page's tabs and of
 * the sale editors: the event, its sales and stocks as the console reads
 * them, and queries that look through the shadow roots of console components.
 */

/** The text a member sees in `el`, including inside shadow roots. */
export function deepText(el: Element | ShadowRoot): string {
	let out = ''
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ''
		if (node instanceof Element && node.shadowRoot) walk(node.shadowRoot)
		for (const child of node.childNodes) walk(child)
	}
	walk(el)
	return out.replace(/\s+/g, ' ').trim()
}

/** Every element under `root` matching `selector`, shadow roots included. */
export function deepAll<T extends Element = HTMLElement>(
	root: Element | ShadowRoot,
	selector: string,
): T[] {
	const found: T[] = []
	const walk = (node: Element | ShadowRoot) => {
		found.push(...node.querySelectorAll<T>(selector))
		for (const el of node.querySelectorAll('*')) {
			if (el.shadowRoot) walk(el.shadowRoot)
		}
		if (node instanceof Element && node.shadowRoot) walk(node.shadowRoot)
	}
	walk(root)
	return [...new Set(found)]
}

export function deepOne<T extends Element = HTMLElement>(
	root: Element | ShadowRoot,
	selector: string,
): T | null {
	return deepAll<T>(root, selector)[0] ?? null
}

/**
 * The buttons and links under `root` whose own text (what the page puts in
 * the control, not what its shadow root adds) or label is exactly `name`.
 */
export function controlsNamed(
	root: Element | ShadowRoot,
	name: string,
): HTMLElement[] {
	return deepAll(root, 'button, a, console-button').filter(
		(el) =>
			(el.textContent ?? '').replace(/\s+/g, ' ').trim() === name ||
			el.getAttribute('aria-label') === name,
	)
}

/** jsdom has no `<dialog>` modal or popover: open and close by attribute. */
export function stubBrowserOverlays(): void {
	HTMLDialogElement.prototype.showModal = function showModal() {
		this.setAttribute('open', '')
	}
	HTMLDialogElement.prototype.close = function close() {
		this.removeAttribute('open')
	}
	HTMLElement.prototype.showPopover ??= () => {}
	HTMLElement.prototype.hidePopover ??= () => {}
}

export const COMPLETE_ORGANIZER = {
	legalName: { value: '株式会社XX' },
	representativeName: { value: '山田太郎' },
	businessAddress: { value: '東京都渋谷区1-2-3' },
	businessPhoneNumber: { value: '0312345678' },
	contactEmail: { value: 'owner@xx-records.example' },
}

/** An Organizer whose business details are complete, but for `missing`. */
export function organizerWithout(
	...missing: Array<keyof typeof COMPLETE_ORGANIZER>
): Organizer {
	const init: Record<string, unknown> = { ...COMPLETE_ORGANIZER }
	for (const key of missing) delete init[key]
	return create(OrganizerSchema, init)
}

/** `2026-11-20` and `19:00` in Japan time as an instant. */
export function jst(date: string, time: string): Date {
	return new Date(`${date}T${time}:00+09:00`)
}

export function eventInit(
	init: Partial<{
		id: string
		localDate: { year: number; month: number; day: number }
		publishState: PublishState
		start: Date | null
		venue: string
	}> = {},
) {
	const start =
		init.start === undefined ? jst('2026-11-03', '18:00') : init.start
	return {
		id: { value: init.id ?? 'e-1103' },
		publishState: init.publishState ?? PublishState.PUBLISHED,
		localDate: { value: init.localDate ?? { year: 2026, month: 11, day: 3 } },
		venue: { name: { value: init.venue ?? 'Zepp Haneda' } },
		...(start ? { startTime: { value: timestampFromDate(start) } } : {}),
	}
}

/** The concert XX Tour 2026 (`s-tour`) with `event` as its one date. */
export function tourWith(event: ReturnType<typeof eventInit>) {
	return authoredSeries({
		series: { id: { value: 's-tour' }, title: { value: 'XX Tour 2026' } },
		events: [event],
		performers: [{ id: { value: 'a-1' } }],
	})
}

export interface SaleInit {
	id: string
	name?: string
	method?: 'LOTTERY' | 'FIRST_COME'
	start: Date
	end: Date
	verification?: VerificationRequirement
	eventIds?: string[]
}

export function ticketSale(init: SaleInit): TicketSale {
	return create(TicketSaleSchema, {
		id: { value: init.id },
		name: { value: init.name ?? 'ファンクラブ先行' },
		method:
			init.method === 'FIRST_COME'
				? TicketSaleMethod.FIRST_COME
				: TicketSaleMethod.LOTTERY,
		saleStartTime: timestampFromDate(init.start),
		saleEndTime: timestampFromDate(init.end),
		verificationRequirement:
			init.verification ?? VerificationRequirement.UNSPECIFIED,
		eventIds: (init.eventIds ?? ['e-1103']).map((value) => ({ value })),
	})
}

export const S_SEAT = { id: 'seat-s', name: 'S席', price: 8000 }
export const A_SEAT = { id: 'seat-a', name: 'A席', price: 6000 }

export interface SeatInit {
	id: string
	name: string
	price: number
}

export function seatType(seat: SeatInit, seriesId = 's-tour') {
	return create(SeatTypeSchema, {
		id: { value: seat.id },
		seriesId: { value: seriesId },
		name: { value: seat.name },
		price: { value: BigInt(seat.price) },
	})
}

export interface StockInit {
	id: string
	seat: SeatInit
	quantity: number
	sold?: number
	held?: number
}

export function ticketStock(stock: StockInit, eventId = 'e-1103') {
	const sold = stock.sold ?? 0
	const held = stock.held ?? 0
	return create(TicketStockSchema, {
		id: { value: stock.id },
		eventId: { value: eventId },
		seatTypeId: { value: stock.seat.id },
		quantity: stock.quantity,
		soldCount: sold,
		heldCount: held,
		state:
			sold >= stock.quantity
				? TicketStockState.SOLD_OUT
				: sold + held >= stock.quantity
					? TicketStockState.ALL_HELD
					: TicketStockState.AVAILABLE,
	})
}

/** A `TicketStockService.ListByEvent` answer: the stocks and their seat types. */
export function stocksOf(
	stocks: StockInit[],
	eventId = 'e-1103',
): EventTicketStocks {
	const seats = new Map(stocks.map((s) => [s.seat.id, s.seat]))
	return {
		ticketStocks: stocks.map((s) => ticketStock(s, eventId)),
		seatTypes: [...seats.values()].map((s) => seatType(s)),
	}
}

export function lotteryEntryStats(
	saleId: string,
	stock: StockInit,
	c: {
		entries: number
		requested: number
		won?: number
		wonTickets?: number
		lost?: number
	},
) {
	return create(LotteryEntryStatsSchema, {
		ticketSaleId: { value: saleId },
		ticketStockId: { value: stock.id },
		seatTypeId: { value: stock.seat.id },
		entryCount: c.entries,
		ticketCount: c.requested,
		wonEntryCount: c.won ?? 0,
		wonTicketCount: c.wonTickets ?? 0,
		lostEntryCount: c.lost ?? 0,
	})
}

/** A fake that records its calls and answers with the given values in turn. */
export function answers<T>(...values: T[]) {
	const fn = vi.fn()
	values.forEach((v, i) => {
		if (i < values.length - 1) fn.mockResolvedValueOnce(v)
		else fn.mockResolvedValue(v)
	})
	return fn
}
