import { ILogger, resolve } from 'aurelia'
import type { DateGroup } from '../components/live-highway/live-event'
import { RegionSetupSheet } from '../components/region-setup-sheet/region-setup-sheet'
import { IDashboardService } from '../services/dashboard-service'

export class Dashboard {
	public dateGroups: DateGroup[] = []
	public needsRegion = false
	public loadError: unknown = null
	public isStale = false

	public regionSheet!: RegionSetupSheet

	private readonly logger = resolve(ILogger).scopeTo('Dashboard')
	private readonly dashboardService = resolve(IDashboardService)
	private abortController: AbortController | null = null

	public dataPromise: Promise<DateGroup[]> | null = null

	public async loading(): Promise<void> {
		this.needsRegion = !RegionSetupSheet.getStoredRegion()
		this.loadData()
	}

	public loadData(): void {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null
		this.isStale = false

		this.dataPromise = this.dashboardService
			.loadDashboardEvents(this.abortController.signal)
			.then((groups) => {
				this.dateGroups = groups
				this.loadError = null
				this.logger.info('Dashboard loaded', { groups: groups.length })
				return groups
			})
			.catch((err) => {
				if ((err as Error).name === 'AbortError') {
					throw err
				}
				this.loadError = err
				this.logger.error('Failed to load dashboard', { error: err })
				// If we have previous data, mark as stale instead of clearing
				if (this.dateGroups.length > 0) {
					this.isStale = true
				}
				throw err
			})
	}

	public retry(): void {
		this.loadData()
	}

	public attached(): void {
		if (this.needsRegion) {
			this.regionSheet.open()
		}
	}

	public onRegionSelected(region: string): void {
		this.logger.info('Region configured', { region })
		this.needsRegion = false
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
