import { bindable, ILogger, resolve, runTasks } from 'aurelia'
import {
	QUICK_SELECT_CITIES,
	REGION_GROUPS,
	type RegionGroup,
} from '../../constants/iso3166'

/**
 * A pure home-area selection UI. It emits the chosen ISO 3166-2 code via
 * {@link onHomeSelected} and owns no persistence: it does NOT call
 * `UserService.updateHome()`, write to localStorage, or resolve `IUserStore` /
 * `IAuthService`. Every save/no-save decision belongs to the caller (Settings,
 * onboarding, or the Timetable the Concerts view area selector).
 */
export class HomeAreaSelector {
	@bindable public onHomeSelected?: (code: string) => void | Promise<void>
	@bindable public required = false
	/**
	 * The currently active ISO 3166-2 code (e.g. `JP-13`), or null when none is
	 * active. Drives the selected-state highlight on the city / prefecture
	 * buttons. Supplied by the caller — the component does NOT derive it from any
	 * store. When null, no option is highlighted.
	 */
	@bindable public currentCode: string | null = null

	public isOpen = false
	public regions = REGION_GROUPS
	public quickCities = QUICK_SELECT_CITIES
	public selectedRegion: RegionGroup | null = null

	/** The element holding the step, set by the template. */
	public stepContent: HTMLElement | null = null

	private readonly logger = resolve(ILogger).scopeTo('HomeAreaSelector')

	/** A choice is being handed to the caller (saving the home). */
	private saving = false

	public open(): void {
		this.selectedRegion = null
		this.isOpen = true
	}

	public onSheetClosed(): void {
		this.isOpen = false
		this.selectedRegion = null
	}

	public selectRegion(region: RegionGroup): void {
		this.showStep(region)
	}

	public backToRegions(): void {
		this.showStep(null)
	}

	/**
	 * Replace the regions with a region's prefectures, or the other way round,
	 * inside a View Transition: the step fades out, then the next fades in,
	 * the same motion both ways (`global.css`, `area-step`). The content is
	 * named only for the transition, so the page behind the sheet is not part
	 * of it, and the browser can skip the transition without losing the step.
	 */
	private showStep(region: RegionGroup | null): void {
		const content = this.stepContent
		if (!content || typeof document.startViewTransition !== 'function') {
			this.selectedRegion = region
			return
		}
		const root = document.documentElement
		root.classList.add('vt-suppress-root')
		content.dataset.stepping = ''
		runTasks()
		const transition = document.startViewTransition(() => {
			this.selectedRegion = region
			runTasks()
		})
		void transition.ready.catch(() => {})
		void transition.finished.finally(() => {
			root.classList.remove('vt-suppress-root')
			delete content.dataset.stepping
		})
	}

	public selectQuickCity(code: string): Promise<void> {
		return this.confirmSelection(code)
	}

	public selectPrefecture(code: string): Promise<void> {
		return this.confirmSelection(code)
	}

	/**
	 * Hand the choice to the caller and close once the caller has handled it.
	 * When the caller rejects (saving the home failed and it has said so), the
	 * sheet stays open on the same choice so the person can try again; the
	 * button shows its busy state meanwhile (`busy-on-click`).
	 */
	private async confirmSelection(code: string): Promise<void> {
		// One choice at a time: a tap on another area while the caller is still
		// saving the first is ignored, so the saves cannot race.
		if (this.saving) return
		this.saving = true
		this.logger.info('Home area selected', { code })
		try {
			await this.onHomeSelected?.(code)
		} catch {
			return
		} finally {
			this.saving = false
		}
		this.isOpen = false
		this.selectedRegion = null
	}
}
