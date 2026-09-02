import type { Params } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { toOrganizerErrorMessage } from '../services/connect-error-copy'
import { ILotteryPhaseClient } from '../services/lottery-phase-client'

/** Coarse lifecycle phase for the status fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

/** A flattened view of a phase's status, free of proto optional-chaining noise. */
export interface LotteryStatusView {
	readonly phaseId: string
	/** True while the application window is currently open. */
	readonly windowOpen: boolean
	/** Human window state, one of "not yet open", "open", or "closed". */
	readonly windowLabel: string
	readonly openTimeLabel: string
	readonly closeTimeLabel: string
	readonly ticketCapacity: number
	readonly maxTicketsPerApplication: number
	readonly ticketPrice: number
	readonly drawCompleted: boolean
	readonly applicationCount: number
	readonly requestedTicketCount: number
	readonly winningApplicationCount: number
	readonly wonTicketCount: number
	readonly waitlistedApplicationCount: number
}

const EMPTY = '—'

/** Formats a proto Timestamp-ish value into a local date-time label, or `—`. */
function formatInstant(ts: { toDate(): Date } | undefined): string {
	if (!ts) return EMPTY
	return ts.toDate().toLocaleString()
}

/**
 * The lottery-phase status / draw-outcome screen (roadmap ④, task 5.2). Reads a
 * phase by its `phaseId` route parameter via
 * {@link ILotteryPhaseClient.getLotteryPhaseStatus} and renders whether the
 * window is open or closed, whether the draw has completed, and the outcome
 * tallies. Pre-draw the tally block is suppressed (the counts are not yet
 * meaningful); post-draw the full summary is shown.
 *
 * Loading, empty (`view` unset), and error states are all handled; errors are
 * translated from `ConnectError` codes via {@link toOrganizerErrorMessage}.
 */
export class LotteryStatusRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public phaseId = ''
	public view: LotteryStatusView | undefined

	private abort: AbortController | null = null

	private readonly client = resolve(ILotteryPhaseClient)
	private readonly logger = resolve(ILogger).scopeTo('LotteryStatusRoute')

	public canLoad(params: Params): boolean {
		this.phaseId = params.phaseId ?? ''
		return true
	}

	public async attached(): Promise<void> {
		await this.load()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.view === undefined
	}

	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const status = await this.client.getLotteryPhaseStatus(
				this.phaseId,
				abort.signal,
			)
			if (abort.signal.aborted) return
			this.view = this.toView(status)
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'Failed to load the lottery phase status.',
			)
			this.phase = 'error'
			this.logger.error('Failed to load lottery phase status', {
				phaseId: this.phaseId,
				err,
			})
		}
	}

	private toView(status: {
		phase?: {
			id?: { value: string }
			openTime?: { toDate(): Date }
			closeTime?: { toDate(): Date }
			ticketCapacity: number
			maxTicketsPerApplication: number
			ticketPrice: bigint
		}
		drawCompleted: boolean
		applicationCount: number
		requestedTicketCount: number
		winningApplicationCount: number
		wonTicketCount: number
		waitlistedApplicationCount: number
	}): LotteryStatusView | undefined {
		const p = status.phase
		if (!p) return undefined
		const now = Date.now()
		const open = p.openTime?.toDate().getTime()
		const close = p.closeTime?.toDate().getTime()
		const windowOpen =
			open !== undefined && close !== undefined && now >= open && now < close
		let windowLabel = EMPTY
		if (open !== undefined && close !== undefined) {
			if (now < open) windowLabel = 'Not yet open'
			else if (now < close) windowLabel = 'Open'
			else windowLabel = 'Closed'
		}
		return {
			phaseId: p.id?.value ?? '',
			windowOpen,
			windowLabel,
			openTimeLabel: formatInstant(p.openTime),
			closeTimeLabel: formatInstant(p.closeTime),
			ticketCapacity: p.ticketCapacity,
			maxTicketsPerApplication: p.maxTicketsPerApplication,
			ticketPrice: Number(p.ticketPrice),
			drawCompleted: status.drawCompleted,
			applicationCount: status.applicationCount,
			requestedTicketCount: status.requestedTicketCount,
			winningApplicationCount: status.winningApplicationCount,
			wonTicketCount: status.wonTicketCount,
			waitlistedApplicationCount: status.waitlistedApplicationCount,
		}
	}
}
