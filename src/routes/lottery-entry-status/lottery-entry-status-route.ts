import type { IRouteViewModel, Params } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
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
 * The visual bucket the view renders: Entered shows the waiting state; Won,
 * Lost and Withdrawn show the result prominently.
 */
export type ResultKind = 'entered' | 'won' | 'lost' | 'withdrawn'

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
 * LotteryEntryService.ListByTicketType (newest first, withdrawn ones
 * included) and shows the newest entry made: its count and state (抽選待ち /
 * 当選 / 落選 / 取下げ済み), and while it awaits the draw an action to
 * withdraw it, which releases the card authorization.
 */
export class LotteryEntryStatusRoute implements IRouteViewModel {
	public step: EntryStatusViewStep = 'loading'
	/** An i18n key for the current error or note, or ''. */
	public messageKey = ''
	public entry: LotteryEntry | null = null

	/** Confirm-step gate for the withdraw action. */
	public confirmingWithdraw = false
	/** True while the withdraw round-trip is in flight (disables the action). */
	public withdrawing = false

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

	private get signal(): AbortSignal | undefined {
		return this.abortController?.signal
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
			case 'withdrawn':
				return this.state
			default:
				return 'entered'
		}
	}

	/** i18n key of the state's label. */
	public get stateLabelKey(): string {
		const known = ['entered', 'won', 'lost', 'withdrawn']
		return `lotteryEntryStatus.state.${known.includes(this.state) ? this.state : 'unknown'}`
	}

	/** Withdraw is offered only while the entry awaits the draw. */
	public get canWithdraw(): boolean {
		return this.state === 'entered' && !this.withdrawing
	}

	// ── Withdraw ──────────────────────────────────────────────────────────────

	public askWithdraw(): void {
		if (!this.canWithdraw) return
		this.messageKey = ''
		this.confirmingWithdraw = true
	}

	public cancelWithdraw(): void {
		this.confirmingWithdraw = false
	}

	/**
	 * Withdraws the entry and reflects the Withdrawn state. When the draw ran
	 * meanwhile (FailedPrecondition), the entries are read again so the result
	 * shows.
	 */
	public async confirmWithdraw(): Promise<void> {
		const entry = this.entry
		if (entry?.state !== 'entered') return
		this.withdrawing = true
		this.messageKey = ''
		try {
			await this.entryClient.withdraw(entry.id, this.signal)
			this.entry = { ...entry, state: 'withdrawn' }
			this.confirmingWithdraw = false
		} catch (err) {
			if (this.signal?.aborted) return
			if (ConnectError.from(err).code === Code.FailedPrecondition) {
				this.confirmingWithdraw = false
				await this.load()
				this.messageKey = 'lotteryEntryStatus.withdraw.drawn'
				return
			}
			this.logger.error('Withdraw failed', { error: err })
			this.messageKey = 'lotteryEntryStatus.withdraw.failed'
		} finally {
			this.withdrawing = false
		}
	}
}
