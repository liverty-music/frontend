import { ILogger, resolve } from 'aurelia'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IToastService } from '../toast-notification/toast-notification'

export class ErrorBanner {
	public readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly toastService = resolve(IToastService)
	private readonly logger = resolve(ILogger).scopeTo('ErrorBanner')

	private lastReportTime = 0
	private static readonly REPORT_COOLDOWN_MS = 60_000

	public async copyErrorDetails(): Promise<void> {
		const error = this.errorBoundary.currentError
		if (!error) return

		const report = this.errorBoundary.generateReport(error)
		try {
			await navigator.clipboard.writeText(report)
			this.toastService.show('Error details copied')
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
				'Please wait before reporting another issue',
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
