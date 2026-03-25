import { bindable, resolve } from 'aurelia'
import { IOnboardingService } from '../../services/onboarding-service'

export type PageHelpPage = 'discovery' | 'dashboard' | 'my-artists'

const STORAGE_PREFIX = 'liverty:onboarding:helpSeen:'

export class PageHelp {
	@bindable public page: PageHelpPage = 'discovery'
	@bindable public followedCount = 0

	public isOpen = false

	private readonly onboarding = resolve(IOnboardingService)

	public attached(): void {
		const key = STORAGE_PREFIX + this.page
		if (this.onboarding.isOnboarding && !localStorage.getItem(key)) {
			localStorage.setItem(key, '1')
			this.isOpen = true
		}
	}

	public open(): void {
		this.isOpen = true
	}

	public onHelpTap(): void {
		this.isOpen = true
	}

	public onSheetClosed(): void {
		this.isOpen = false
	}

	public get ariaLabel(): string {
		return 'ヘルプを表示'
	}

	public static clearHelpSeen(): void {
		for (const page of ['discovery', 'dashboard', 'my-artists'] as const) {
			localStorage.removeItem(STORAGE_PREFIX + page)
		}
	}
}
