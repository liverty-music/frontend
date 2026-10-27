import type { IRouteViewModel, Params } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { ILotteryEntryRpcClient } from '../../adapter/rpc/client/lottery-entry-client'
import type {
	LotteryEntry,
	LotteryEntryState,
} from '../../entities/lottery-entry'

/**
 * Discrete UI phases of the entry status view.
 *   - `loading` — the entries are being read.
 *   - `empty`   — the fan made no entry for this TicketType.
 *   - `error`   — the read failed; a reload is offered.
 *   - `loaded`  — `entry` drives the render.
 */
export type EntryStatusViewStep = 'loading' | 'empty' | 'error' | 'loaded'

/**
 * The visual bucket the view renders: Entered shows the waiting state; Won
 * and Lost show the result prominently.
 */
export type ResultKind = 'entered' | 'won' | 'lost'

/**
 * The entry a status screen shows: the newest that is not a Draft. A Draft
 * was never entered, so it is not an entry the fan made.
 */
export function shownEntry(
	entries: readonly LotteryEntry[],
): LotteryEntry | null {
	return entries.find((e) => e.state !== 'draft') ?? null
}

/**
 * The fan's lottery entry status for one TicketType
 * (`/events/:id/lottery/:ticketTypeId/entry`). Reads the fan's entries with
 * LotteryEntryService.ListByTicketType (newest first) and shows the newest
 * entry made: its count and state (抽選待ち / 当選 / 落選). An entry cannot be
 * withdrawn once made.
 */
export class LotteryEntryStatusRoute implements IRouteViewModel {
	public step: EntryStatusViewStep = 'loading'
	/** An i18n key for the current error or note, or ''. */
	public messageKey = ''
	public entry: LotteryEntry | null = null

	private ticketTypeId = ''
	private readonly logger = resolve(ILogger).scopeTo('LotteryEntryStatusRoute')
	private readonly entryClient = resolve(ILotteryEntryRpcClient)
	private abortController: AbortController | null = null

	public loading(params: Params): void {
		this.ticketTypeId = params.ticketTypeId ?? ''
		// Never hold the view swap on data: start the read and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	public async load(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		const { signal } = this.abortController
		this.step = 'loading'
		this.messageKey = ''
		try {
			const entries = await this.entryClient.listByTicketType(
				this.ticketTypeId,
				signal,
			)
			if (signal.aborted) return
			this.entry = shownEntry(entries)
			this.step = this.entry ? 'loaded' : 'empty'
		} catch (err) {
			if (signal.aborted) return
			this.logger.error('Lottery entry read failed', { error: err })
			this.messageKey = 'lotteryEntryStatus.error'
			this.step = 'error'
		}
	}

	// ── Derived state ─────────────────────────────────────────────────────────

	private get state(): LotteryEntryState {
		return this.entry?.state ?? 'unknown'
	}

	/** The visual bucket the template renders for the current state. */
	public get resultKind(): ResultKind {
		switch (this.state) {
			case 'won':
			case 'lost':
				return this.state
			default:
				return 'entered'
		}
	}

	/** i18n key of the state's label. */
	public get stateLabelKey(): string {
		const known = ['entered', 'won', 'lost']
		return `lotteryEntryStatus.state.${known.includes(this.state) ? this.state : 'unknown'}`
	}
}
