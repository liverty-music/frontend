import { I18N } from '@aurelia/i18n'
import { IEventAggregator, IWindow, resolve } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { IErrorBoundaryService } from '../../services/error-boundary-service'

export class ErrorBanner {
	public readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly window = resolve(IWindow)

	private lastEmailTime = 0
	private static readonly EMAIL_COOLDOWN_MS = 60_000

	/** The report email for the current error, as the link's `href`. */
	public get reportMailto(): string {
		const error = this.errorBoundary.currentError
		return error ? this.errorBoundary.buildReportMailto(error) : ''
	}

	/**
	 * Opens the fan's mail app with the report email, in the same tab: a
	 * `_blank` window for `mailto:` leaves an empty tab behind. A second tap
	 * within a minute only says to wait.
	 */
	public emailReport(): void {
		const error = this.errorBoundary.currentError
		if (!error) return

		const now = Date.now()
		if (now - this.lastEmailTime < ErrorBanner.EMAIL_COOLDOWN_MS) {
			this.ea.publish(
				new Snack(this.i18n.tr('errorBanner.reportCooldown'), 'warning'),
			)
			return
		}
		this.lastEmailTime = now

		this.window.location.href = this.errorBoundary.buildReportMailto(error)
	}

	public dismiss(): void {
		this.errorBoundary.dismiss()
	}

	public reload(): void {
		this.window.location.reload()
	}
}
