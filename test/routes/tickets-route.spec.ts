import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockProofService } from '../helpers/mock-proof-service'
import { createMockTicketService } from '../helpers/mock-ticket-service'

const mockITicketRpcClient = DI.createInterface('ITicketRpcClient')
const mockIProofService = DI.createInterface('IProofService')
const mockIUserService = DI.createInterface('IUserService')

vi.mock('../../src/adapter/rpc/client/ticket-client', () => ({
	ITicketRpcClient: mockITicketRpcClient,
}))

vi.mock('../../src/services/proof-service', () => ({
	IProofService: mockIProofService,
}))

vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
}))

vi.mock('qrcode', () => {
	const toDataURL = vi.fn().mockResolvedValue('data:image/png;base64,fakeQR')
	return {
		default: { toDataURL },
		toDataURL,
	}
})

const { TicketsRoute } = await import('../../src/routes/tickets/tickets-route')

describe('TicketsRoute', () => {
	let sut: InstanceType<typeof TicketsRoute>
	let mockTicketService: ReturnType<typeof createMockTicketService>
	let mockProofService: ReturnType<typeof createMockProofService>
	let mockUserService: { current: { id: string } | undefined }

	beforeEach(() => {
		mockTicketService = createMockTicketService()
		mockProofService = createMockProofService()
		mockUserService = { current: { id: 'u1' } }

		const container = createTestContainer(
			Registration.instance(mockITicketRpcClient, mockTicketService),
			Registration.instance(mockIProofService, mockProofService),
			Registration.instance(mockIUserService, mockUserService),
		)
		container.register(TicketsRoute)
		sut = container.get(TicketsRoute)

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
		it('should return Date when mintTime is set', () => {
			const ticket = {
				id: 't1',
				eventId: 'e1',
				userId: 'u1',
				mintTime: new Date(1700000000500),
			} as any

			const result = sut.mintDate(ticket)

			expect(result).toBeInstanceOf(Date)
			expect(result!.getTime()).toBe(1700000000500)
		})

		it('should return null when no mintTime', () => {
			const result = sut.mintDate({ id: 't1' } as any)
			expect(result).toBeNull()
		})
	})

	describe('formatTokenId', () => {
		it('should format token ID with hash prefix', () => {
			const ticket = { tokenId: '42' } as any
			expect(sut.formatTokenId(ticket)).toBe('#42')
		})

		it('should return empty string when no tokenId', () => {
			expect(sut.formatTokenId({} as any)).toBe('')
		})
	})

	describe('loading', () => {
		it('should load tickets', async () => {
			const fakeTickets = [{ id: 't1', eventId: 'e1', userId: 'u1' }]
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

		it('should set "Not signed in" error when user service has no current user', async () => {
			mockUserService.current = undefined

			await sut.loading()

			expect(sut.error).toBe('Not signed in.')
			expect(mockTicketService.listTickets).not.toHaveBeenCalled()
		})
	})

	describe('generateEntryCode', () => {
		it('should generate proof and complete without error', async () => {
			const ticket = { id: 't1', eventId: 'e1', userId: 'u1' } as any

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
			const ticket = { id: 't1', eventId: '', userId: 'u1' } as any

			await sut.generateEntryCode(ticket)

			expect(sut.error).toBe('Missing ticket data.')
		})

		it('should set error when proof generation fails', async () => {
			;(
				mockProofService.generateEntryProof as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('proof failed'))

			const ticket = { id: 't1', eventId: 'e1', userId: 'u1' } as any

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

			const ticket = { id: 't1', eventId: 'e1', userId: 'u1' } as any

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
