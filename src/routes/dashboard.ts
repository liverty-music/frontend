import { ILogger, resolve } from 'aurelia'
import type { DateGroup } from '../components/live-highway/live-event'
import { IDashboardService } from '../services/dashboard-service'

export class Dashboard {
	public dateGroups: DateGroup[] = []
	public isLoading = true

	private readonly logger = resolve(ILogger).scopeTo('Dashboard')
	private readonly dashboardService = resolve(IDashboardService)
	private abortController: AbortController | null = null

	public async loading(): Promise<void> {
		this.isLoading = true
		this.abortController = new AbortController()

		try {
			this.dateGroups = await this.dashboardService.loadDashboardEvents(
				this.abortController.signal,
			)
			this.logger.info('Dashboard loaded', {
				groups: this.dateGroups.length,
			})
		} catch (err) {
			if ((err as Error).name !== 'AbortError') {
				this.logger.error('Failed to load dashboard', { error: err })
			}
		} finally {
			this.isLoading = false
		}
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
