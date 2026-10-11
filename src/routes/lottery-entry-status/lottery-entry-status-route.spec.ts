import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LotteryEntry } from '../../entities/lottery-entry'

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
	listByTicketType: vi.fn(),
	withdraw: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				ILotteryEntryRpcClient: mockEntry,
			}
			return map[(token as { friendlyName?: string }).friendlyName ?? ''] ?? {}
		}),
	}
})

import {
	LotteryEntryStatusRoute,
	shownEntry,
} from './lottery-entry-status-route'

function entry(o: Partial<LotteryEntry> = {}): LotteryEntry {
	return {
		id: 'entry-1',
		ticketTypeId: 'type-1',
		ticketCount: 2,
		state: 'entered',
		...o,
	}
}

async function open(): Promise<LotteryEntryStatusRoute> {
	const sut = new LotteryEntryStatusRoute()
	sut.loading({ id: 'event-1', ticketTypeId: 'type-1' })
	await vi.waitFor(() => expect(sut.step).not.toBe('loading'))
	return sut
}

describe('shownEntry', () => {
	it('shows the newest entry that is not a Draft', () => {
		expect(
			shownEntry([
				entry({ id: 'draft', state: 'draft' }),
				entry({ id: 'newest' }),
				entry({ id: 'older', state: 'withdrawn' }),
			])?.id,
		).toBe('newest')
		expect(shownEntry([entry({ state: 'draft' })])).toBeNull()
	})
})

describe('LotteryEntryStatusRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockEntry.listByTicketType.mockResolvedValue([entry()])
		mockEntry.withdraw.mockResolvedValue(undefined)
	})

	it("reads the fan's entries for the TicketType", async () => {
		const sut = await open()

		expect(mockEntry.listByTicketType).toHaveBeenCalledWith(
			'type-1',
			expect.anything(),
		)
		expect(sut.step).toBe('loaded')
		expect(sut.entry?.ticketCount).toBe(2)
		expect(sut.resultKind).toBe('entered')
		expect(sut.stateLabelKey).toBe('lotteryEntryStatus.state.entered')
	})

	it.each([
		['won', 'won'],
		['lost', 'lost'],
		['withdrawn', 'withdrawn'],
	] as const)('shows a %s entry as %s', async (state, kind) => {
		mockEntry.listByTicketType.mockResolvedValue([entry({ state })])
		const sut = await open()
		expect(sut.resultKind).toBe(kind)
		expect(sut.canWithdraw).toBe(false)
	})

	it('is empty when the fan made no entry', async () => {
		mockEntry.listByTicketType.mockResolvedValue([entry({ state: 'draft' })])
		const sut = await open()
		expect(sut.step).toBe('empty')
	})

	it('offers a reload when the read fails', async () => {
		mockEntry.listByTicketType.mockRejectedValue(new Error('offline'))
		const sut = await open()
		expect(sut.step).toBe('error')
		expect(sut.messageKey).toBe('lotteryEntryStatus.error')
	})

	it('withdraws the entry after the fan confirms', async () => {
		const sut = await open()
		sut.askWithdraw()
		expect(sut.confirmingWithdraw).toBe(true)

		await sut.confirmWithdraw()

		expect(mockEntry.withdraw).toHaveBeenCalledWith(
			'entry-1',
			expect.anything(),
		)
		expect(sut.entry?.state).toBe('withdrawn')
		expect(sut.confirmingWithdraw).toBe(false)
	})

	it('shows the result when the draw ran before the withdrawal', async () => {
		mockEntry.withdraw.mockRejectedValue(
			new ConnectError('drawn', Code.FailedPrecondition),
		)
		const sut = await open()
		mockEntry.listByTicketType.mockResolvedValue([entry({ state: 'won' })])

		await sut.confirmWithdraw()

		expect(sut.resultKind).toBe('won')
		expect(sut.messageKey).toBe('lotteryEntryStatus.withdraw.drawn')
	})

	it('says the withdrawal failed otherwise', async () => {
		mockEntry.withdraw.mockRejectedValue(new Error('boom'))
		const sut = await open()

		await sut.confirmWithdraw()

		expect(sut.entry?.state).toBe('entered')
		expect(sut.messageKey).toBe('lotteryEntryStatus.withdraw.failed')
	})
})
