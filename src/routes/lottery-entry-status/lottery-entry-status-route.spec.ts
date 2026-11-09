import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LotteryEntry } from '../../entities/lottery-entry'
import css from './lottery-entry-status-route.css?raw'
import html from './lottery-entry-status-route.html?raw'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const mockEntry = {
	listByTicketSale: vi.fn(),
}
const mockSale = { listByEvent: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				ILotteryEntryRpcClient: mockEntry,
				ITicketSaleRpcClient: mockSale,
			}
			return map[(token as { friendlyName?: string }).friendlyName ?? ''] ?? {}
		}),
	}
})

import { LotteryEntryStatusRoute } from './lottery-entry-status-route'

function entry(o: Partial<LotteryEntry> = {}): LotteryEntry {
	return {
		id: 'entry-1',
		orderId: 'order-1',
		ticketSaleId: 'sale-1',
		ticketStockId: 'stock-a',
		ticketCount: 2,
		state: 'entered',
		...o,
	}
}

async function open(): Promise<LotteryEntryStatusRoute> {
	const sut = new LotteryEntryStatusRoute()
	sut.loading({ id: 'event-1', saleId: 'sale-1', stockId: 'stock-s' })
	await vi.waitFor(() => expect(sut.step).not.toBe('loading'))
	return sut
}

describe('LotteryEntryStatusRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockEntry.listByTicketSale.mockResolvedValue([entry()])
		mockSale.listByEvent.mockResolvedValue({
			sales: [],
			stocks: [
				{ id: 'stock-s', seatTypeName: 'S席' },
				{ id: 'stock-a', seatTypeName: 'A席' },
			],
			perAccountLimit: 4,
		})
	})

	it("reads the fan's entry in the sale for this event, whichever seat type", async () => {
		const sut = await open()

		expect(mockEntry.listByTicketSale).toHaveBeenCalledWith(
			'sale-1',
			expect.anything(),
		)
		expect(mockSale.listByEvent).toHaveBeenCalledWith(
			'event-1',
			expect.anything(),
		)
		expect(sut.step).toBe('loaded')
		expect(sut.stock?.seatTypeName).toBe('A席')
		expect(sut.entry?.ticketCount).toBe(2)
		expect(sut.resultKind).toBe('entered')
		expect(sut.stateLabelKey).toBe('lotteryEntryStatus.state.entered')
	})

	it.each([
		['won', 'won'],
		['lost', 'lost'],
	] as const)('shows a %s entry as %s', async (state, kind) => {
		mockEntry.listByTicketSale.mockResolvedValue([entry({ state })])
		const sut = await open()
		expect(sut.resultKind).toBe(kind)
		expect(sut.stateLabelKey).toBe(`lotteryEntryStatus.state.${state}`)
	})

	it.each([
		['won', 'positive'],
		['lost', 'neutral'],
		['entered', 'neutral'],
	] as const)('labels a %s entry in the %s tone', async (state, tone) => {
		mockEntry.listByTicketSale.mockResolvedValue([entry({ state })])
		const sut = await open()
		expect(sut.resultTone).toBe(tone)
	})

	it('shows a state this app does not know as awaiting the draw, unlabelled', async () => {
		mockEntry.listByTicketSale.mockResolvedValue([entry({ state: 'unknown' })])
		const sut = await open()
		expect(sut.resultKind).toBe('entered')
		expect(sut.stateLabelKey).toBe('lotteryEntryStatus.state.unknown')
	})

	it("is empty when the fan's only entry in the sale is for another date", async () => {
		mockEntry.listByTicketSale.mockResolvedValue([
			entry({ ticketStockId: 'stock-of-another-date' }),
		])
		const sut = await open()
		expect(sut.step).toBe('empty')
	})

	it('is empty when the fan made no entry', async () => {
		mockEntry.listByTicketSale.mockResolvedValue([])
		const sut = await open()
		expect(sut.step).toBe('empty')
	})

	it('offers a reload when the read fails', async () => {
		mockEntry.listByTicketSale.mockRejectedValue(new Error('offline'))
		const sut = await open()
		expect(sut.step).toBe('error')
		expect(sut.messageKey).toBe('lotteryEntryStatus.error')
	})
})

describe('lottery result heading', () => {
	it('shows the result as the large heading in the card, not a status label', () => {
		const t = document.createElement('template')
		t.innerHTML = html
		// The view is itself a <template>; read its content.
		const view = t.content.querySelector('template')?.content ?? t.content
		const result = view.querySelector('.lottery-entry-status-result')
		expect(result?.classList.contains('md-typescale-headline-small')).toBe(true)
		expect(result?.getAttribute('data-tone.bind')).toBe('resultTone')
		expect(view.querySelector('.status-label')).toBeNull()
	})

	it('colours a win with tertiary and every other result with on-surface-variant', () => {
		const rule = css.slice(css.indexOf('.lottery-entry-status-result {'))
		const block = rule.slice(0, rule.indexOf('\n\t\t}\n'))
		expect(block).toContain('color: var(--md-sys-color-on-surface-variant)')
		expect(block).toMatch(
			/\[data-tone="positive"\] \{\s*color: var\(--md-sys-color-tertiary\)/,
		)
		expect(block).not.toContain('border')
	})
})
