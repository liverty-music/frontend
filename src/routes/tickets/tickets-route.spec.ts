import { TicketStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}),
}

const mockTicketClient = {
	getMyTickets: vi.fn(async () => []),
	getOrder: vi.fn(async () => undefined),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				ITicketRpcClient: mockTicketClient,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
	}
})

import type { TicketView } from './tickets-route'
import { TicketsRoute } from './tickets-route'

// Flush pending microtasks (loading() kicks off an async load()).
const flush = () => new Promise((r) => setTimeout(r, 0))

/**
 * Build a minimal TicketView for testing; caller can override any field.
 */
function makeTicketView(overrides: Partial<TicketView> = {}): TicketView {
	return {
		id: 't-1',
		eventId: 'event-1',
		orderId: 'order-1',
		holderName: '山田太郎',
		holderPhone: '09012345678',
		issuedAt: new Date('2026-09-01'),
		isIssued: true,
		isVoided: false,
		resaleWithoutConsentProhibited: true,
		...overrides,
	}
}

async function makeSut(): Promise<TicketsRoute> {
	const sut = new TicketsRoute()
	sut.loading()
	await flush()
	return sut
}

describe('TicketsRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockTicketClient.getMyTickets.mockResolvedValue([])
	})

	// ── Load state machine ────────────────────────────────────────────────────

	describe('step transitions', () => {
		it('shows empty when the caller has no tickets', async () => {
			mockTicketClient.getMyTickets.mockResolvedValue([])
			const sut = await makeSut()
			expect(sut.step).toBe('empty')
		})

		it('surfaces a load failure as the error state with a non-empty message', async () => {
			mockTicketClient.getMyTickets.mockRejectedValueOnce(
				new Error('network failure'),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('error')
			expect(sut.error).not.toBe('')
		})

		it('switches to loaded when tickets are returned', async () => {
			// Use real proto objects to exercise the toView mapping.
			const { TicketSchema } = await import(
				'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
			)
			const rawTickets = [
				create(TicketSchema, {
					id: { value: 't-1' },
					eventId: { value: 'event-1' },
					holderIdentity: { fullName: '山田太郎', phoneNumber: '09012345678' },
					resaleWithoutConsentProhibited: true,
					status: TicketStatus.ISSUED,
				}),
			]
			mockTicketClient.getMyTickets.mockResolvedValue(rawTickets)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.tickets).toHaveLength(1)
		})
	})

	// ── View mapping (using TicketView stubs; toView is exercised via load) ───

	describe('loaded: ticket count', () => {
		it('renders all returned tickets', async () => {
			const { TicketSchema } = await import(
				'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
			)
			const rawTickets = [
				create(TicketSchema, {
					id: { value: 't-1' },
					eventId: { value: 'event-1' },
					holderIdentity: { fullName: '鈴木花子', phoneNumber: '08011112222' },
					status: TicketStatus.ISSUED,
					resaleWithoutConsentProhibited: true,
				}),
				create(TicketSchema, {
					id: { value: 't-2' },
					eventId: { value: 'event-2' },
					holderIdentity: { fullName: '田中一郎', phoneNumber: '07033334444' },
					status: TicketStatus.VOIDED,
					resaleWithoutConsentProhibited: false,
				}),
			]
			mockTicketClient.getMyTickets.mockResolvedValue(rawTickets)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.tickets).toHaveLength(2)
		})
	})

	// ── statusLabel() helper ───────────────────────────────────────────────────

	describe('statusLabel', () => {
		it('returns 発券済み for an ISSUED ticket', () => {
			const sut = new TicketsRoute()
			const ticket = makeTicketView({ isIssued: true, isVoided: false })
			expect(sut.statusLabel(ticket)).toBe('発券済み')
		})

		it('returns 無効 for a VOIDED ticket', () => {
			const sut = new TicketsRoute()
			const ticket = makeTicketView({ isIssued: false, isVoided: true })
			expect(sut.statusLabel(ticket)).toBe('無効')
		})

		it('returns — when status is neither ISSUED nor VOIDED', () => {
			const sut = new TicketsRoute()
			const ticket = makeTicketView({ isIssued: false, isVoided: false })
			expect(sut.statusLabel(ticket)).toBe('—')
		})
	})

	// ── formatDate() helper ───────────────────────────────────────────────────

	describe('formatDate', () => {
		it('returns — when date is null', () => {
			const sut = new TicketsRoute()
			expect(sut.formatDate(null)).toBe('—')
		})

		it('returns a non-empty Japanese locale string for a valid date', () => {
			const sut = new TicketsRoute()
			const result = sut.formatDate(new Date('2026-09-01T00:00:00Z'))
			expect(result).not.toBe('—')
			expect(result.length).toBeGreaterThan(0)
		})
	})

	// ── AbortController cleanup ────────────────────────────────────────────────

	describe('detaching', () => {
		it('aborts any in-flight request on detach', () => {
			const sut = new TicketsRoute()
			sut.loading()
			// After loading() an AbortController is alive; detaching() must abort it.
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
			sut.detaching()
			expect(abortSpy).toHaveBeenCalled()
		})
	})

	// ── Reload via load() after error ─────────────────────────────────────────

	describe('error retry', () => {
		it('clears the error and reloads when load() is called again', async () => {
			mockTicketClient.getMyTickets.mockRejectedValueOnce(new Error('boom'))
			const sut = await makeSut()
			expect(sut.step).toBe('error')

			mockTicketClient.getMyTickets.mockResolvedValue([])
			await sut.load()
			expect(sut.step).toBe('empty')
			expect(sut.error).toBe('')
		})
	})
})
