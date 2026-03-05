import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockProofService } from '../helpers/mock-proof-service'
import { createMockTicketService } from '../helpers/mock-ticket-service'

const mockITicketService = DI.createInterface('ITicketService')
const mockIProofService = DI.createInterface('IProofService')

vi.mock('../../src/services/ticket-service', () => ({
	ITicketService: mockITicketService,
}))

vi.mock('../../src/services/proof-service', () => ({
	IProofService: mockIProofService,
}))

vi.mock('qrcode', () => {
	const toDataURL = vi.fn().mockResolvedValue('data:image/png;base64,fakeQR')
	return {
		default: { toDataURL },
		toDataURL,
	}
})

const { TicketsPage } = await import('../../src/routes/tickets/tickets-page')

describe('TicketsPage', () => {
	let sut: InstanceType<typeof TicketsPage>
	let mockTicketService: ReturnType<typeof createMockTicketService>
	let mockProofService: ReturnType<typeof createMockProofService>

	beforeEach(() => {
		mockTicketService = createMockTicketService()
		mockProofService = createMockProofService()

		const container = createTestContainer(
			Registration.instance(mockITicketService, mockTicketService),
			Registration.instance(mockIProofService, mockProofService),
		)
		container.register(TicketsPage)
		sut = container.get(TicketsPage)

		// Mock dialog elements for Top Layer API
		const mockGeneratingDialog = document.createElement('dialog')
		;(mockGeneratingDialog as any).showModal = vi.fn()
		;(mockGeneratingDialog as any).close = vi.fn()
		;(sut as any).generatingDialog = mockGeneratingDialog

		const mockQrDialog = document.createElement('dialog')
		;(mockQrDialog as any).showModal = vi.fn()
		;(mockQrDialog as any).close = vi.fn()
		;(sut as any).qrDialog = mockQrDialog
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('mintDate', () => {
		it('should convert timestamp to Date', () => {
			const ticket = {
				mintTime: { seconds: BigInt(1700000000), nanos: 500_000_000 },
			} as any

			const result = sut.mintDate(ticket)

			expect(result).toBeInstanceOf(Date)
			expect(result!.getTime()).toBe(1700000000 * 1000 + 500)
		})

		it('should return null when no mintTime', () => {
			const result = sut.mintDate({} as any)
			expect(result).toBeNull()
		})
	})

	describe('formatTokenId', () => {
		it('should format token ID with hash prefix', () => {
			const ticket = { tokenId: { value: 42 } } as any
			expect(sut.formatTokenId(ticket)).toBe('#42')
		})

		it('should return empty string when no tokenId', () => {
			expect(sut.formatTokenId({} as any)).toBe('')
		})
	})

	describe('loading', () => {
		it('should load tickets', async () => {
			const fakeTickets = [{ id: { value: 't1' } }]
			;(
				mockTicketService.listTickets as ReturnType<typeof vi.fn>
			).mockResolvedValue(fakeTickets)

			await sut.loading()

			expect(sut.tickets).toEqual(fakeTickets)
			expect(sut.isLoading).toBe(false)
			expect(sut.error).toBe('')
		})

		it('should set error on failure', async () => {
			;(
				mockTicketService.listTickets as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('network'))

			await sut.loading()

			expect(sut.error).toContain('Failed to load tickets')
			expect(sut.isLoading).toBe(false)
		})

		it('should ignore AbortError', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			;(
				mockTicketService.listTickets as ReturnType<typeof vi.fn>
			).mockRejectedValue(abortError)

			await sut.loading()

			expect(sut.error).toBe('')
		})
	})

	describe('generateEntryCode', () => {
		it('should generate proof and complete without error', async () => {
			const ticket = {
				id: { value: 't1' },
				eventId: { value: 'e1' },
				userId: { value: 'u1' },
			} as any

			await sut.loading() // set up abortController
			await sut.generateEntryCode(ticket)

			expect(mockProofService.generateEntryProof).toHaveBeenCalledWith(
				'e1',
				'u1',
				expect.any(Function),
				expect.anything(),
			)
			expect(sut.isGenerating).toBe(false)
		})

		it('should set error when eventId is missing', async () => {
			const ticket = { userId: { value: 'u1' } } as any

			await sut.generateEntryCode(ticket)

			expect(sut.error).toBe('Missing ticket data.')
		})

		it('should set error when proof generation fails', async () => {
			;(
				mockProofService.generateEntryProof as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('proof failed'))

			const ticket = {
				id: { value: 't1' },
				eventId: { value: 'e1' },
				userId: { value: 'u1' },
			} as any

			await sut.loading()
			await sut.generateEntryCode(ticket)

			expect(sut.error).toContain('Failed to generate entry code')
			expect(sut.qrDataUrl).toBe('')
		})

		it('should ignore AbortError during proof generation', async () => {
			const abortError = new DOMException('aborted', 'AbortError')
			;(
				mockProofService.generateEntryProof as ReturnType<typeof vi.fn>
			).mockRejectedValue(abortError)

			const ticket = {
				id: { value: 't1' },
				eventId: { value: 'e1' },
				userId: { value: 'u1' },
			} as any

			await sut.loading()
			await sut.generateEntryCode(ticket)

			expect(sut.error).toBe('')
		})
	})

	describe('dismissQr', () => {
		it('should clear QR data', () => {
			sut.qrDataUrl = 'data:image/png;base64,test'
			sut.generatingTicketId = 't1'

			sut.dismissQr()

			expect(sut.qrDataUrl).toBe('')
			expect(sut.generatingTicketId).toBe('')
		})
	})
})
