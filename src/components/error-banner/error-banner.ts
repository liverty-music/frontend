import { I18N } from '@aurelia/i18n'
import { ILogger, resolve, watch } from 'aurelia'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IToastService } from '../toast-notification/toast-notification'

export class ErrorBanner {
	public readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly toastService = resolve(IToastService)
	private readonly logger = resolve(ILogger).scopeTo('ErrorBanner')
	private readonly i18n = resolve(I18N)

	private dialogElement!: HTMLDialogElement
	private lastReportTime = 0
	private static readonly REPORT_COOLDOWN_MS = 60_000

	@watch<ErrorBanner>((eb) => eb.errorBoundary.currentError)
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: invoked by @watch decorator
	private onErrorChanged(): void {
		if (this.errorBoundary.currentError) {
			this.dialogElement.showModal()
		} else {
			this.dialogElement.close()
		}
	}

	public async copyErrorDetails(): Promise<void> {
		const error = this.errorBoundary.currentError
		if (!error) return

		const report = this.errorBoundary.generateReport(error)
		try {
			await navigator.clipboard.writeText(report)
			this.toastService.show(this.i18n.tr('errorBanner.copied'))
		} catch (err) {
			this.logger.warn('Failed to copy to clipboard', err)
		}
	}

	public reportToGitHub(): void {
		const error = this.errorBoundary.currentError
		if (!error) return

		const now = Date.now()
		if (now - this.lastReportTime < ErrorBanner.REPORT_COOLDOWN_MS) {
			this.toastService.show(
				this.i18n.tr('errorBanner.reportCooldown'),
				'warning',
			)
			return
		}
		this.lastReportTime = now

		const url = this.errorBoundary.buildGitHubIssueUrl(error)
		window.open(url, '_blank', 'noopener')
	}

	public dismiss(): void {
		this.errorBoundary.dismiss()
	}

	public reload(): void {
		window.location.reload()
	}
}
