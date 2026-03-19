import { ILogger, resolve } from 'aurelia'
import QRCode from 'qrcode'
import { ITicketRpcClient } from '../../adapter/rpc/client/ticket-client'
import type { Ticket } from '../../entities/ticket'
import { IProofService } from '../../services/proof-service'

export class TicketsRoute {
	public tickets: Ticket[] = []
	public isLoading = true
	public error = ''

	public isGenerating = false
	public proofProgress = ''
	public qrDataUrl = ''
	public showQrSheet = false
	public generatingTicketId = ''

	private readonly logger = resolve(ILogger).scopeTo('TicketsRoute')
	private readonly ticketClient = resolve(ITicketRpcClient)
	private readonly proofService = resolve(IProofService)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.isLoading = true
		this.error = ''
		this.abortController = new AbortController()

		try {
			this.tickets = await this.ticketClient.listTickets(
				this.abortController.signal,
			)
			this.logger.info('Tickets loaded', { count: this.tickets.length })
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load tickets', { error: err })
				this.error = 'Failed to load tickets. Please try again.'
			}
		} finally {
			this.isLoading = false
		}
	}

	public mintDate(ticket: Ticket): Date | null {
		return ticket.mintTime ?? null
	}

	public formatTokenId(ticket: Ticket): string {
		if (ticket.tokenId === undefined) return ''
		return `#${ticket.tokenId}`
	}

	public async generateEntryCode(ticket: Ticket): Promise<void> {
		if (!ticket.eventId || !ticket.userId) {
			this.error = 'Missing ticket data.'
			return
		}

		this.isGenerating = true
		this.proofProgress = 'Preparing...'
		this.qrDataUrl = ''
		this.generatingTicketId = ticket.id
		this.error = ''

		try {
			const proofOutput = await this.proofService.generateEntryProof(
				ticket.eventId,
				ticket.userId,
				(stage) => {
					this.proofProgress = stage
				},
				this.abortController?.signal,
			)

			this.proofProgress = 'Creating QR code...'

			const payload = JSON.stringify({
				eventId: ticket.eventId,
				proof: JSON.parse(proofOutput.proofJson),
				publicSignals: JSON.parse(proofOutput.publicSignalsJson),
				exp: Date.now() + 5 * 60 * 1000, // 5-minute expiry
			})
			const encoded = btoa(payload)

			this.qrDataUrl = await QRCode.toDataURL(encoded, {
				width: 280,
				margin: 2,
				color: { dark: '#000000', light: '#ffffff' },
			})
			this.showQrSheet = true

			this.proofProgress = ''
			this.logger.info('Entry code generated', { eventId: ticket.eventId })
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Proof generation failed', { error: err })
				this.error = 'Failed to generate entry code. Please try again.'
			}
			this.qrDataUrl = ''
		} finally {
			this.isGenerating = false
		}
	}

	public dismissQr(): void {
		this.showQrSheet = false
		this.qrDataUrl = ''
		this.generatingTicketId = ''
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
