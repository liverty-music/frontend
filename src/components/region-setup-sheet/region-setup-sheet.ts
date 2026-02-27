import { I18N } from '@aurelia/i18n'
import { bindable, ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'

const PREFECTURE_KEYS = [
	'hokkaido',
	'aomori',
	'iwate',
	'miyagi',
	'akita',
	'yamagata',
	'fukushima',
	'ibaraki',
	'tochigi',
	'gunma',
	'saitama',
	'chiba',
	'tokyo',
	'kanagawa',
	'niigata',
	'toyama',
	'ishikawa',
	'fukui',
	'yamanashi',
	'nagano',
	'gifu',
	'shizuoka',
	'aichi',
	'mie',
	'shiga',
	'kyoto',
	'osaka',
	'hyogo',
	'nara',
	'wakayama',
	'tottori',
	'shimane',
	'okayama',
	'hiroshima',
	'yamaguchi',
	'tokushima',
	'kagawa',
	'ehime',
	'kochi',
	'fukuoka',
	'saga',
	'nagasaki',
	'kumamoto',
	'oita',
	'miyazaki',
	'kagoshima',
	'okinawa',
]

const QUICK_SELECT_CITY_KEYS = [
	'tokyo',
	'osaka',
	'nagoya',
	'fukuoka',
	'sapporo',
	'sendai',
]

// Map quick-select city keys to their prefecture key
const CITY_TO_PREFECTURE: Record<string, string> = {
	tokyo: 'tokyo',
	osaka: 'osaka',
	nagoya: 'aichi',
	fukuoka: 'fukuoka',
	sapporo: 'hokkaido',
	sendai: 'miyagi',
}

export class RegionSetupSheet {
	@bindable public onRegionSelected?: (region: string) => void

	public isOpen = false
	public prefectureKeys = PREFECTURE_KEYS
	public cityKeys = QUICK_SELECT_CITY_KEYS
	public selectedPrefecture = ''

	private dialogElement?: HTMLDialogElement
	private readonly logger = resolve(ILogger).scopeTo('RegionSetupSheet')
	private readonly i18n = resolve(I18N)

	public trPrefecture(key: string): string {
		return this.i18n.tr(`region.prefectures.${key}`)
	}

	public trCity(key: string): string {
		return this.i18n.tr(`region.cities.${key}`)
	}

	public static getStoredRegion(): string | null {
		return localStorage.getItem(StorageKeys.userAdminArea)
	}

	public open(): void {
		this.selectedPrefecture = ''
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

	public selectQuickCity(cityKey: string): void {
		const prefectureKey = CITY_TO_PREFECTURE[cityKey] ?? cityKey
		this.saveRegion(prefectureKey)
	}

	public selectPrefecture(): void {
		if (!this.selectedPrefecture) return
		this.saveRegion(this.selectedPrefecture)
	}

	private saveRegion(prefecture: string): void {
		this.logger.info('Region selected', { prefecture })
		localStorage.setItem(StorageKeys.userAdminArea, prefecture)
		this.close()
		this.onRegionSelected?.(prefecture)
	}
}
