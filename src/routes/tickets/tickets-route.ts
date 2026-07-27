import { ILogger, resolve } from 'aurelia'
import QRCode from 'qrcode'
import type { Ticket } from '../../entities/ticket'
import { IProofService } from '../../services/proof-service'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { ITicketStore } from '../../services/ticket-store'
import { IUserStore } from '../../services/user-store'

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
	private readonly ticketStore = resolve(ITicketStore)
	private readonly proofService = resolve(IProofService)
	private readonly userStore = resolve(IUserStore)
	private readonly resumeRevalidator = resolve(IResumeRevalidator)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.isLoading = true
		this.error = ''
		this.abortController = new AbortController()

		try {
			const userId = this.userStore.current?.id
			if (!userId) {
				this.error = 'Not signed in.'
				return
			}

			// Paint from cache (SWR) on re-entry; on a cold miss this fetches fresh.
			const hadCache = this.ticketStore.hasCache(userId)
			this.tickets = await this.ticketStore.listTickets(
				userId,
				this.abortController.signal,
			)
			this.logger.info('Tickets loaded', { count: this.tickets.length })
			// Route re-entry: force a background refresh and swap in place.
			if (hadCache) this.revalidate()
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load tickets', { error: err })
				this.error = 'Failed to load tickets. Please try again.'
			}
		} finally {
			this.isLoading = false
		}
	}

	public attached(): void {
		// Refresh the cached ticket list when the installed PWA returns to the
		// foreground (only while this route is the active one).
		this.resumeRevalidator.register(this.revalidate)
	}

	/**
	 * Force a background refresh of the ticket list and swap it in place — no
	 * spinner, no scroll reset. Bound to route re-entry and PWA resume.
	 */
	public readonly revalidate = (): void => {
		void this.revalidateTickets()
	}

	private async revalidateTickets(): Promise<void> {
		const userId = this.userStore.current?.id
		if (!userId) return
		try {
			const fresh = await this.ticketStore.revalidateTickets(userId)
			if (this.abortController?.signal.aborted) return
			this.tickets = fresh
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Ticket revalidation failed', { error: err })
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
		this.resumeRevalidator.unregister(this.revalidate)
		this.abortController?.abort()
		this.abortController = null
	}
}
