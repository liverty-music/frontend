import { bindable, resolve } from 'aurelia'
import {
	clearAllHelpSeen,
	loadHelpSeen,
	saveHelpSeen,
} from '../../adapter/storage/onboarding-storage'
import { IOnboardingService } from '../../services/onboarding-service'

export type PageHelpPage = 'discovery' | 'dashboard' | 'my-artists'

/** Pages where the help sheet auto-opens on first visit (spec-defined). */
const AUTO_OPEN_PAGES: ReadonlySet<PageHelpPage> = new Set([
	'discovery',
	'my-artists',
])

export class PageHelp {
	@bindable public page: PageHelpPage = 'discovery'

	public isOpen = false
	public isPointerCoarse = false

	private readonly onboarding = resolve(IOnboardingService)

	public attached(): void {
		this.isPointerCoarse =
			window.matchMedia?.('(pointer: coarse)').matches ?? false

		if (
			AUTO_OPEN_PAGES.has(this.page) &&
			this.onboarding.isOnboarding &&
			!loadHelpSeen(this.page)
		) {
			saveHelpSeen(this.page)
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
		clearAllHelpSeen()
	}
}
