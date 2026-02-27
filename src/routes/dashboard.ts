import { IRouter } from '@aurelia/router'
import { I18N } from '@aurelia/i18n'
import { ILogger, resolve } from 'aurelia'
import type { DateGroup } from '../components/live-highway/live-event'
import { RegionSetupSheet } from '../components/region-setup-sheet/region-setup-sheet'
import { IDashboardService } from '../services/dashboard-service'
import { ILocalArtistClient } from '../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../services/onboarding-service'

export class Dashboard {
	public dateGroups: DateGroup[] = []
	public needsRegion = false
	public loadError: unknown = null
	public isStale = false

	public regionSheet!: RegionSetupSheet

	private readonly logger = resolve(ILogger).scopeTo('Dashboard')
	public readonly i18n = resolve(I18N)
	private readonly dashboardService = resolve(IDashboardService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly router = resolve(IRouter)
	private abortController: AbortController | null = null

	public dataPromise: Promise<DateGroup[]> | null = null

	public get isTutorialStep3(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DASHBOARD
	}

	public get isTutorialStep4(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DETAIL
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

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
		if (this.isOnboarding) {
			this.localClient.setAdminArea(region)
		}
	}

	public onTutorialCardTapped(): void {
		if (this.isTutorialStep3) {
			this.logger.info('Tutorial: concert card tapped, advancing to Step 4')
			this.onboarding.setStep(OnboardingStep.DETAIL)
		}
	}

	public async onTutorialMyArtistsTapped(): Promise<void> {
		if (this.isTutorialStep4) {
			this.logger.info('Tutorial: My Artists tab tapped, advancing to Step 5')
			this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
			await this.router.load('my-artists')
		}
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
