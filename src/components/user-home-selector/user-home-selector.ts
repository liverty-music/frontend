import { bindable, ILogger, resolve } from 'aurelia'
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
 * onboarding, or the Dashboard All Nearby area selector).
 */
export class UserHomeSelector {
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

	private readonly logger = resolve(ILogger).scopeTo('UserHomeSelector')

	public open(): void {
		this.selectedRegion = null
		this.isOpen = true
	}

	public onSheetClosed(): void {
		this.isOpen = false
		this.selectedRegion = null
	}

	public selectRegion(region: RegionGroup): void {
		this.selectedRegion = region
	}

	public backToRegions(): void {
		this.selectedRegion = null
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
		this.logger.info('Home area selected', { code })
		try {
			await this.onHomeSelected?.(code)
		} catch {
			return
		}
		this.isOpen = false
		this.selectedRegion = null
	}
}
