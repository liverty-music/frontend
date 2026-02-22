import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { ILogger, resolve } from 'aurelia'
import QRCode from 'qrcode'
import { IProofService } from '../../services/proof-service'
import { ITicketService } from '../../services/ticket-service'

export class TicketsPage {
	public tickets: Ticket[] = []
	public isLoading = true
	public error = ''

	public isGenerating = false
	public proofProgress = ''
	public qrDataUrl = ''
	public generatingTicketId = ''
	public qrModal: HTMLElement | null = null

	private readonly logger = resolve(ILogger).scopeTo('TicketsPage')
	private readonly ticketService = resolve(ITicketService)
	private readonly proofService = resolve(IProofService)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.isLoading = true
		this.error = ''
		this.abortController = new AbortController()

		try {
			this.tickets = await this.ticketService.listTickets(
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

	public formatDate(ticket: Ticket): string {
		const ts = ticket.mintTime
		if (!ts) return ''
		const date = new Date(Number(ts.seconds) * 1000 + ts.nanos / 1_000_000)
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		})
	}

	public formatTokenId(ticket: Ticket): string {
		const value = ticket.tokenId?.value
		if (value === undefined) return ''
		return `#${value.toString()}`
	}

	public async generateEntryCode(ticket: Ticket): Promise<void> {
		const eventId = ticket.eventId?.value
		const userId = ticket.userId?.value
		if (!eventId || !userId) {
			this.error = 'Missing ticket data.'
			return
		}

		this.isGenerating = true
		this.proofProgress = 'Preparing...'
		this.qrDataUrl = ''
		this.generatingTicketId = ticket.id?.value ?? ''
		this.error = ''

		try {
			const proofOutput = await this.proofService.generateEntryProof(
				eventId,
				userId,
				(stage) => {
					this.proofProgress = stage
				},
				this.abortController?.signal,
			)

			this.proofProgress = 'Creating QR code...'

			const payload = JSON.stringify({
				eventId,
				proof: JSON.parse(proofOutput.proofJson),
				publicSignals: JSON.parse(proofOutput.publicSignalsJson),
			})
			const encoded = btoa(payload)

			this.qrDataUrl = await QRCode.toDataURL(encoded, {
				width: 280,
				margin: 2,
				color: { dark: '#000000', light: '#ffffff' },
			})

			this.proofProgress = ''
			this.logger.info('Entry code generated', { eventId })

			// Focus the modal for keyboard accessibility
			requestAnimationFrame(() => this.qrModal?.focus())
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
		this.qrDataUrl = ''
		this.generatingTicketId = ''
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
