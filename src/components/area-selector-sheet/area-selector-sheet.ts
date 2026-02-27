import { I18N } from '@aurelia/i18n'
import { bindable, ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'

export interface Region {
	key: string
	prefectureKeys: string[]
}

const REGIONS: Region[] = [
	{ key: 'hokkaido', prefectureKeys: ['hokkaido'] },
	{
		key: 'tohoku',
		prefectureKeys: [
			'aomori',
			'iwate',
			'miyagi',
			'akita',
			'yamagata',
			'fukushima',
		],
	},
	{
		key: 'kanto',
		prefectureKeys: [
			'ibaraki',
			'tochigi',
			'gunma',
			'saitama',
			'chiba',
			'tokyo',
			'kanagawa',
		],
	},
	{
		key: 'chubu',
		prefectureKeys: [
			'niigata',
			'toyama',
			'ishikawa',
			'fukui',
			'yamanashi',
			'nagano',
			'gifu',
			'shizuoka',
			'aichi',
		],
	},
	{
		key: 'kinki',
		prefectureKeys: [
			'mie',
			'shiga',
			'kyoto',
			'osaka',
			'hyogo',
			'nara',
			'wakayama',
		],
	},
	{
		key: 'chugoku',
		prefectureKeys: ['tottori', 'shimane', 'okayama', 'hiroshima', 'yamaguchi'],
	},
	{ key: 'shikoku', prefectureKeys: ['tokushima', 'kagawa', 'ehime', 'kochi'] },
	{
		key: 'kyushu',
		prefectureKeys: [
			'fukuoka',
			'saga',
			'nagasaki',
			'kumamoto',
			'oita',
			'miyazaki',
			'kagoshima',
			'okinawa',
		],
	},
]

export class AreaSelectorSheet {
	@bindable public onAreaSelected?: (area: string) => void

	public isOpen = false
	public regions = REGIONS
	public selectedRegion: Region | null = null

	private dialogElement?: HTMLDialogElement
	private readonly logger = resolve(ILogger).scopeTo('AreaSelectorSheet')
	private readonly i18n = resolve(I18N)

	public trRegion(key: string): string {
		return this.i18n.tr(`region.regions.${key}`)
	}

	public trPrefecture(key: string): string {
		return this.i18n.tr(`region.prefectures.${key}`)
	}

	public static getStoredArea(): string | null {
		return localStorage.getItem(StorageKeys.userAdminArea)
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

	public selectRegion(region: Region): void {
		this.selectedRegion = region
	}

	public backToRegions(): void {
		this.selectedRegion = null
	}

	public selectPrefecture(prefectureKey: string): void {
		this.logger.info('Area selected', { prefecture: prefectureKey })
		localStorage.setItem(StorageKeys.userAdminArea, prefectureKey)
		this.close()
		this.onAreaSelected?.(prefectureKey)
	}
}
