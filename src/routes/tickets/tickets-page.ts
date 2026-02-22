import type { Ticket } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_pb.js'
import { ILogger, resolve } from 'aurelia'
import { ITicketService } from '../../services/ticket-service'

export class TicketsPage {
	public tickets: Ticket[] = []
	public isLoading = true
	public error = ''

	private readonly logger = resolve(ILogger).scopeTo('TicketsPage')
	private readonly ticketService = resolve(ITicketService)
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

	public generateEntryCode(ticket: Ticket): void {
		// Navigate to proof generation flow (Section 12 — not yet implemented)
		this.logger.info('Generate entry code requested', {
			ticketId: ticket.id?.value,
		})
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
