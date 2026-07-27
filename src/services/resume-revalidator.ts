import { DI, ILogger, resolve } from 'aurelia'

export const IResumeRevalidator = DI.createInterface<IResumeRevalidator>(
	'IResumeRevalidator',
	(x) => x.singleton(ResumeRevalidator),
)

export interface IResumeRevalidator extends ResumeRevalidator {}

/** Background revalidation triggered when the PWA returns to the foreground. */
export type RevalidateFn = () => void

/**
 * A single app-level Page-Visibility hook that revalidates the cached resources
 * owned by the stores backing the **currently active route** when the installed
 * PWA returns to the foreground.
 *
 * Only the attached, in-viewport route is registered at any time (routes
 * register in `attached()` and unregister in `detaching()`), so the resume
 * signal never fans out to stores whose route is not currently active. Revalidation
 * is non-destructive: the registered callback swaps fresh data into the store's
 * observable in place; it never reloads the document. This does not double-fire
 * with route-entry revalidation — that is a separate trigger, and both paths
 * coalesce at the cache primitive, so a concurrent entry + resume share one RPC.
 */
export class ResumeRevalidator {
	private readonly logger = resolve(ILogger).scopeTo('ResumeRevalidator')
	private active: RevalidateFn | null = null
	private listening = false

	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState !== 'visible') return
		try {
			this.active?.()
		} catch (err) {
			this.logger.warn('Resume revalidation callback threw', { error: err })
		}
	}

	/**
	 * Register the active route's revalidation callback. Lazily attaches the one
	 * shared `visibilitychange` listener on first use. A later registration
	 * replaces the previous active route (route transitions unregister the old and
	 * register the new).
	 */
	public register(fn: RevalidateFn): void {
		this.active = fn
		if (!this.listening) {
			document.addEventListener('visibilitychange', this.onVisibilityChange)
			this.listening = true
		}
	}

	/** Unregister a route's callback (only if it is still the active one). */
	public unregister(fn: RevalidateFn): void {
		if (this.active === fn) {
			this.active = null
		}
	}
}
