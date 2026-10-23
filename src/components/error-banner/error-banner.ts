import { I18N } from '@aurelia/i18n'
import { IEventAggregator, IWindow, resolve } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import {
	IErrorBoundaryService,
	REPORT_EMAIL_ADDRESS,
} from '../../services/error-boundary-service'

export class ErrorBanner {
	public readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly window = resolve(IWindow)

	/** The contact address, shown once the fan has tried the email. */
	public readonly emailAddress = REPORT_EMAIL_ADDRESS

	/**
	 * Whether the fan has tapped メールで状況を伝える on this banner. The page
	 * cannot tell whether a mail app opened (a device without one does
	 * nothing), so after the first tap the banner shows the address as well.
	 */
	public emailTapped = false

	private lastEmailTime = 0
	private static readonly EMAIL_COOLDOWN_MS = 60_000

	/**
	 * Opens the fan's mail app with the report email, in the same tab: a
	 * `_blank` window for `mailto:` leaves an empty tab behind. A second tap
	 * within a minute only says to wait.
	 */
	public emailReport(): void {
		const error = this.errorBoundary.currentError
		if (!error) return
		this.emailTapped = true

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
		this.emailTapped = false
		this.errorBoundary.dismiss()
	}

	public reload(): void {
		this.window.location.reload()
	}
}
