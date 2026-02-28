import { I18N } from '@aurelia/i18n'
import { bindable, ILogger, resolve } from 'aurelia'
import {
	codeToHome,
	REGION_GROUPS,
	type RegionGroup,
} from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { IUserService } from '../../services/user-service'

export class AreaSelectorSheet {
	@bindable public onAreaSelected?: (area: string) => void

	public isOpen = false
	public regions = REGION_GROUPS
	public selectedRegion: RegionGroup | null = null

	private dialogElement?: HTMLDialogElement
	private readonly logger = resolve(ILogger).scopeTo('AreaSelectorSheet')
	private readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)

	public trRegion(key: string): string {
		return this.i18n.tr(`region.regions.${key}`)
	}

	public trPrefecture(key: string): string {
		return this.i18n.tr(`region.prefectures.${key}`)
	}

	public static getStoredArea(): string | null {
		return localStorage.getItem(StorageKeys.guestHome)
	}

	public open(): void {
		this.selectedRegion = null
		this.dialogElement?.showModal()
		this.isOpen = true
	}

	public close(): void {
		this.dialogElement?.close()
		this.isOpen = false
		this.selectedRegion = null
	}

	public handleBackdropClick(event: MouseEvent): void {
		if (event.target === this.dialogElement) {
			this.close()
		}
	}

	public handleCancel(event: Event): void {
		event.preventDefault()
		this.close()
	}

	public selectRegion(region: RegionGroup): void {
		this.selectedRegion = region
	}

	public backToRegions(): void {
		this.selectedRegion = null
	}

	public async selectPrefecture(code: string): Promise<void> {
		this.logger.info('Area selected', { code })

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
		this.onAreaSelected?.(code)
	}
}
