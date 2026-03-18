import { bindable, ILogger, resolve } from 'aurelia'
import {
	codeToHome,
	QUICK_SELECT_CITIES,
	REGION_GROUPS,
	type RegionGroup,
} from '../../constants/iso3166'
import { IAuthService } from '../../services/auth-service'
import { IUserService } from '../../services/user-service'
import { resolveStore } from '../../state/store-interface'

export class UserHomeSelector {
	@bindable public onHomeSelected?: (code: string) => void
	@bindable public required = false

	public isOpen = false
	public regions = REGION_GROUPS
	public quickCities = QUICK_SELECT_CITIES
	public selectedRegion: RegionGroup | null = null

	private readonly logger = resolve(ILogger).scopeTo('UserHomeSelector')
	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly store = resolveStore()

	public static getStoredHome(): string | null {
		return localStorage.getItem('guest.home')
	}

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

	public selectQuickCity(code: string): void {
		this.confirmSelection(code)
	}

	public selectPrefecture(code: string): void {
		this.confirmSelection(code)
	}

	private async confirmSelection(code: string): Promise<void> {
		this.logger.info('Home area selected', { code })

		if (this.authService.isAuthenticated) {
			try {
				await this.userService.updateHome(codeToHome(code))
			} catch (err) {
				this.logger.error('Failed to update home via RPC', err)
			}
		} else {
			this.store.dispatch({ type: 'guest/setUserHome', code })
		}

		this.isOpen = false
		this.selectedRegion = null
		this.onHomeSelected?.(code)
	}
}
