import { CODE_ROTATION_MS } from '../../../shared/lib/admission-code/admission-code'

/** Wait before trying again when signing failed. */
const RETRY_MS = 1000

/** Signs a code for these tickets at this Unix second; returns its QR text. */
export type EntryCodeSigner = (
	ticketIds: readonly string[],
	signTime: number,
) => Promise<string>

/**
 * The entry QR code while it is shown: a new code is signed on the device
 * every 15 seconds (no connection needed), and a code is withdrawn the moment
 * it is 15 seconds old, so the screen never shows an older one. Ages count
 * from the signed time written into the code.
 *
 * Browsers pause timers on a hidden page; {@link check} is called when the
 * page becomes visible again so a stale code is replaced before it is seen.
 */
export class EntryCodeSession {
	/** QR text of the current code, or null when none may be shown. */
	public text: string | null = null
	/** Signed time of the current code, Unix seconds. */
	public signTime = 0
	/** True while signing failed and no code could be made. */
	public failed = false

	private ticketIds: readonly string[] = []
	private running = false
	private generation = 0
	private expiryTimer: ReturnType<typeof setTimeout> | null = null

	constructor(
		private readonly sign: EntryCodeSigner,
		private readonly now: () => number = Date.now,
	) {}

	/** Start showing a code for these tickets. */
	public start(ticketIds: readonly string[]): Promise<void> {
		this.running = true
		return this.setTickets(ticketIds)
	}

	/** Change the ticked tickets: the code is remade at once for the new set. */
	public setTickets(ticketIds: readonly string[]): Promise<void> {
		this.ticketIds = [...ticketIds]
		return this.refresh()
	}

	/** Replace the code when it is due (or overdue, after the page was hidden). */
	public check(): Promise<void> {
		if (!this.running) return Promise.resolve()
		if (this.text !== null && !this.isExpired()) return Promise.resolve()
		return this.refresh()
	}

	/** Stop: withdraw the code and the timer. */
	public stop(): void {
		this.running = false
		this.generation++
		this.clearTimer()
		this.text = null
		this.failed = false
	}

	private isExpired(): boolean {
		return this.now() >= this.signTime * 1000 + CODE_ROTATION_MS
	}

	private async refresh(): Promise<void> {
		const generation = ++this.generation
		this.clearTimer()
		// Withdraw the old code before signing: it may be stale or show the
		// wrong head count.
		this.text = null
		if (!this.running || this.ticketIds.length === 0) return

		const signTime = Math.floor(this.now() / 1000)
		let text: string
		try {
			text = await this.sign(this.ticketIds, signTime)
		} catch {
			if (generation !== this.generation) return
			this.failed = true
			this.expiryTimer = setTimeout(() => void this.check(), RETRY_MS)
			return
		}
		if (generation !== this.generation) return
		this.failed = false
		this.signTime = signTime
		if (this.isExpired()) {
			// Signing took so long the code is already due; make another.
			void this.refresh()
			return
		}
		this.text = text
		this.expiryTimer = setTimeout(
			() => void this.check(),
			signTime * 1000 + CODE_ROTATION_MS - this.now(),
		)
	}

	private clearTimer(): void {
		if (this.expiryTimer !== null) {
			clearTimeout(this.expiryTimer)
			this.expiryTimer = null
		}
	}
}
