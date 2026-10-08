import { DI, ILogger, resolve } from 'aurelia'

export const IScreenWakeLock = DI.createInterface<IScreenWakeLock>(
	'IScreenWakeLock',
	(x) => x.transient(ScreenWakeLock),
)

export interface IScreenWakeLock extends ScreenWakeLock {}

/**
 * Keeps the display on while something must stay visible (the entry QR code)
 * with the Screen Wake Lock API. The browser releases the lock whenever the
 * page is hidden, so it is requested again when the page becomes visible.
 * Unsupported or refused requests are ignored: the screen still works, it may
 * just dim.
 */
export class ScreenWakeLock {
	private readonly logger = resolve(ILogger).scopeTo('ScreenWakeLock')
	private sentinel: WakeLockSentinel | null = null
	private wanted = false
	private readonly doc: Document = document

	/** Hold the lock until {@link release}, across hide/show of the page. */
	public async acquire(): Promise<void> {
		if (!this.wanted) {
			this.wanted = true
			this.doc.addEventListener('visibilitychange', this.onVisibilityChange)
		}
		await this.request()
	}

	/** Stop keeping the display on. */
	public async release(): Promise<void> {
		this.wanted = false
		this.doc.removeEventListener('visibilitychange', this.onVisibilityChange)
		const sentinel = this.sentinel
		this.sentinel = null
		try {
			await sentinel?.release()
		} catch (err) {
			this.logger.debug('Wake lock release failed', { error: err })
		}
	}

	/** Whether the lock is currently held. */
	public get held(): boolean {
		return this.sentinel !== null && !this.sentinel.released
	}

	private readonly onVisibilityChange = (): void => {
		if (this.doc.visibilityState === 'visible') void this.request()
	}

	private async request(): Promise<void> {
		if (!this.wanted || this.held) return
		try {
			const sentinel = (await navigator.wakeLock?.request('screen')) ?? null
			if (!this.wanted) {
				// Released while the request was pending.
				await sentinel?.release()
				return
			}
			this.sentinel = sentinel
		} catch (err) {
			// NotAllowedError (battery saver, hidden page) or unsupported.
			this.logger.debug('Wake lock request failed', { error: err })
			this.sentinel = null
		}
	}
}
