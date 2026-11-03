import { bindable, resolve } from 'aurelia'
import {
	clearOnboardingSeenFlags,
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
	/**
	 * False defers the first-visit auto-open: the page shows another sheet
	 * first (My Artists asks for the home area) and calls {@link
	 * openIfFirstVisit} once that sheet is done, so two sheets never open at
	 * once.
	 */
	@bindable public autoOpen = true

	public isOpen = false

	private readonly onboarding = resolve(IOnboardingService)

	public attached(): void {
		if (this.autoOpen) this.openIfFirstVisit()
	}

	/** Open the help on a first visit to an auto-open page during onboarding. */
	public openIfFirstVisit(): void {
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

	public onSheetClosed(): void {
		this.isOpen = false
	}

	public static clearHelpSeen(): void {
		clearOnboardingSeenFlags()
	}
}
