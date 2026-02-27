import { I18N } from '@aurelia/i18n'
import { bindable, ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'
import {
	JP_PREFECTURE_OPTIONS,
	QUICK_SELECT_CITIES,
	codeToHome,
} from '../../constants/iso3166'
import { IAuthService } from '../../services/auth-service'
import { IUserService } from '../../services/user-service'

export class RegionSetupSheet {
	@bindable public onRegionSelected?: (region: string) => void

	public isOpen = false
	public prefectures = JP_PREFECTURE_OPTIONS
	public quickCities = QUICK_SELECT_CITIES
	public selectedCode = ''

	private dialogElement?: HTMLDialogElement
	private readonly logger = resolve(ILogger).scopeTo('RegionSetupSheet')
	private readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)

	public trPrefecture(key: string): string {
		return this.i18n.tr(`region.prefectures.${key}`)
	}

	public trCity(key: string): string {
		return this.i18n.tr(`region.cities.${key}`)
	}

	public static getStoredRegion(): string | null {
		return localStorage.getItem(StorageKeys.guestHome)
	}

	public open(): void {
		this.selectedCode = ''
		this.dialogElement?.showModal()
		this.isOpen = true
	}

	public close(): void {
		this.dialogElement?.close()
		this.isOpen = false
	}

	public handleBackdropClick(event: MouseEvent): void {
		if (event.target === this.dialogElement) {
			this.close()
		}
	}

	public selectQuickCity(code: string): void {
		this.saveRegion(code)
	}

	public selectPrefecture(): void {
		if (!this.selectedCode) return
		this.saveRegion(this.selectedCode)
	}

	private async saveRegion(code: string): Promise<void> {
		this.logger.info('Region selected', { code })

		if (this.authService.isAuthenticated) {
			try {
				await this.userService.updateHome(codeToHome(code))
			} catch (err) {
				this.logger.error('Failed to update home via RPC', err)
			}
		} else {
			localStorage.setItem(StorageKeys.guestHome, code)
		}

		this.close()
		this.onRegionSelected?.(code)
	}
}
