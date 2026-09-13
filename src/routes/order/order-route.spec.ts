import {
	OrderStatus,
	OrderSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import {
	TicketStatus,
	TicketSchema,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
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
	getOrder: vi.fn(),
	getMyTickets: vi.fn(async () => []),
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

import { OrderRoute } from './order-route'

// Flush pending microtasks (loading() kicks off an async load()).
const flush = () => new Promise((r) => setTimeout(r, 0))

/**
 * Build a minimal proto Order for testing.
 */
function makeOrder(overrides: Partial<Parameters<typeof create>[1]> = {}) {
	return create(OrderSchema, {
		id: { value: 'order-1' },
		status: OrderStatus.PAID,
		amount: BigInt(10000),
		currency: 'JPY',
		payment: {
			cardBrand: 'visa',
			cardLast4: '4242',
		},
		...overrides,
	})
}

async function makeSut(orderId = 'order-1'): Promise<OrderRoute> {
	const sut = new OrderRoute()
	sut.loading({ orderId })
	await flush()
	return sut
}

describe('OrderRoute', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockTicketClient.getMyTickets.mockResolvedValue([])
	})

	// ── Step transitions ──────────────────────────────────────────────────────

	describe('step transitions', () => {
		it('shows loaded when getOrder returns a paid order', async () => {
			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.order?.statusKind).toBe('paid')
		})

		it('shows loaded with refunded statusKind when ORDER_STATUS_REFUNDED', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.REFUNDED }),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.order?.statusKind).toBe('refunded')
		})

		it('shows loaded with failed statusKind when ORDER_STATUS_FAILED', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.FAILED }),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.order?.statusKind).toBe('failed')
		})

		it('fails safe: UNSPECIFIED/unknown status is NOT rendered as paid', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.UNSPECIFIED }),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('loaded')
			expect(sut.order?.statusKind).toBe('unknown')
			expect(sut.order?.statusKind).not.toBe('paid')
		})

		it('shows notfound when getOrder throws ConnectError NotFound', async () => {
			mockTicketClient.getOrder.mockRejectedValue(
				new ConnectError('not found', Code.NotFound),
			)
			const sut = await makeSut()
			expect(sut.step).toBe('notfound')
		})

		it('shows error state on unexpected failure', async () => {
			mockTicketClient.getOrder.mockRejectedValue(new Error('network failure'))
			const sut = await makeSut()
			expect(sut.step).toBe('error')
			expect(sut.error).not.toBe('')
		})
	})

	// ── Ticket filtering ──────────────────────────────────────────────────────

	describe('ticket filtering', () => {
		it('includes only tickets whose orderId matches the current orderId', async () => {
			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			const rawTickets = [
				create(TicketSchema, {
					id: { value: 't-1' },
					orderId: { value: 'order-1' },
					eventId: { value: 'event-1' },
					holderIdentity: { fullName: '山田太郎', phoneNumber: '09012345678' },
					status: TicketStatus.ISSUED,
					resaleWithoutConsentProhibited: true,
				}),
				create(TicketSchema, {
					id: { value: 't-2' },
					orderId: { value: 'order-OTHER' },
					eventId: { value: 'event-2' },
					holderIdentity: { fullName: '鈴木花子', phoneNumber: '08011112222' },
					status: TicketStatus.ISSUED,
					resaleWithoutConsentProhibited: false,
				}),
			]
			mockTicketClient.getMyTickets.mockResolvedValue(rawTickets)
			const sut = await makeSut('order-1')
			expect(sut.step).toBe('loaded')
			expect(sut.tickets).toHaveLength(1)
			expect(sut.tickets[0].id).toBe('t-1')
		})

		it('shows voided tickets for a refunded order (tickets.length > 0)', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.REFUNDED }),
			)
			const rawTickets = [
				create(TicketSchema, {
					id: { value: 't-voided' },
					orderId: { value: 'order-1' },
					eventId: { value: 'event-1' },
					holderIdentity: { fullName: '山田太郎', phoneNumber: '09012345678' },
					status: TicketStatus.VOIDED,
					resaleWithoutConsentProhibited: true,
				}),
			]
			mockTicketClient.getMyTickets.mockResolvedValue(rawTickets)
			const sut = await makeSut('order-1')
			expect(sut.step).toBe('loaded')
			expect(sut.order?.statusKind).toBe('refunded')
			expect(sut.tickets).toHaveLength(1)
			expect(sut.tickets[0].isVoided).toBe(true)
		})

		it('has empty tickets array when no tickets belong to this order', async () => {
			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			mockTicketClient.getMyTickets.mockResolvedValue([])
			const sut = await makeSut()
			expect(sut.tickets).toHaveLength(0)
		})
	})

	// ── View mapping ──────────────────────────────────────────────────────────

	describe('order view mapping', () => {
		it('maps amount to formatted JPY string', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ amount: BigInt(15000) }),
			)
			const sut = await makeSut()
			expect(sut.order?.amountFormatted).toContain('15,000')
		})

		it('maps card brand and last4 when present', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ payment: { cardBrand: 'mastercard', cardLast4: '1234' } }),
			)
			const sut = await makeSut()
			expect(sut.order?.cardBrand).toBe('mastercard')
			expect(sut.order?.cardLast4).toBe('1234')
		})

		it('sets empty cardLast4 when payment is absent', async () => {
			const orderNoPayment = create(OrderSchema, {
				id: { value: 'order-1' },
				status: OrderStatus.PAID,
				amount: BigInt(5000),
				currency: 'JPY',
			})
			mockTicketClient.getOrder.mockResolvedValue(orderNoPayment)
			const sut = await makeSut()
			expect(sut.order?.cardLast4).toBe('')
		})
	})

	// ── statusLabel computed getter ────────────────────────────────────────────

	describe('statusLabel', () => {
		it('returns 支払済み for paid order', async () => {
			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			const sut = await makeSut()
			expect(sut.statusLabel).toBe('支払済み')
		})

		it('returns 返金済み for refunded order', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.REFUNDED }),
			)
			const sut = await makeSut()
			expect(sut.statusLabel).toBe('返金済み')
		})

		it('returns 失敗 for failed order', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.FAILED }),
			)
			const sut = await makeSut()
			expect(sut.statusLabel).toBe('失敗')
		})

		it('returns 状態不明 for an unknown/UNSPECIFIED status (fail-safe, not 支払済み)', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ status: OrderStatus.UNSPECIFIED }),
			)
			const sut = await makeSut()
			expect(sut.statusLabel).toBe('状態不明')
		})

		it('returns — when no order is loaded', () => {
			const sut = new OrderRoute()
			expect(sut.statusLabel).toBe('—')
		})
	})

	// ── ticketStatusLabel helper ───────────────────────────────────────────────

	describe('ticketStatusLabel', () => {
		it('returns 発券済み for an ISSUED ticket', () => {
			const sut = new OrderRoute()
			expect(
				sut.ticketStatusLabel({
					id: 't-1',
					eventId: 'e-1',
					holderName: '山田太郎',
					holderPhone: '090',
					issuedAt: null,
					isIssued: true,
					isVoided: false,
					resaleWithoutConsentProhibited: false,
				}),
			).toBe('発券済み')
		})

		it('returns 無効 for a VOIDED ticket', () => {
			const sut = new OrderRoute()
			expect(
				sut.ticketStatusLabel({
					id: 't-1',
					eventId: 'e-1',
					holderName: '山田太郎',
					holderPhone: '090',
					issuedAt: null,
					isIssued: false,
					isVoided: true,
					resaleWithoutConsentProhibited: false,
				}),
			).toBe('無効')
		})
	})

	// ── formatDate helper ─────────────────────────────────────────────────────

	describe('formatDate', () => {
		it('returns — when date is null', () => {
			const sut = new OrderRoute()
			expect(sut.formatDate(null)).toBe('—')
		})

		it('returns a non-empty Japanese locale string for a valid date', () => {
			const sut = new OrderRoute()
			const result = sut.formatDate(new Date('2026-09-01T00:00:00Z'))
			expect(result).not.toBe('—')
			expect(result.length).toBeGreaterThan(0)
		})
	})

	// ── orderId param handling ─────────────────────────────────────────────────

	describe('loading() param handling', () => {
		it('reads orderId from route params', async () => {
			mockTicketClient.getOrder.mockResolvedValue(
				makeOrder({ id: { value: 'order-abc' } }),
			)
			const sut = new OrderRoute()
			sut.loading({ orderId: 'order-abc' })
			await flush()
			expect(mockTicketClient.getOrder).toHaveBeenCalledWith(
				'order-abc',
				expect.anything(),
			)
		})
	})

	// ── AbortController cleanup ───────────────────────────────────────────────

	describe('detaching', () => {
		it('aborts any in-flight request on detach', () => {
			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			const sut = new OrderRoute()
			sut.loading({ orderId: 'order-1' })
			const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
			sut.detaching()
			expect(abortSpy).toHaveBeenCalled()
		})
	})

	// ── Error retry ───────────────────────────────────────────────────────────

	describe('error retry', () => {
		it('clears the error and reloads when load() is called again', async () => {
			mockTicketClient.getOrder.mockRejectedValueOnce(new Error('boom'))
			const sut = await makeSut()
			expect(sut.step).toBe('error')

			mockTicketClient.getOrder.mockResolvedValue(makeOrder())
			await sut.load()
			expect(sut.step).toBe('loaded')
			expect(sut.error).toBe('')
		})
	})
})
