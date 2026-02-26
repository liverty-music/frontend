import { bindable, ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../../constants/storage-keys'

export interface Region {
	name: string
	prefectures: string[]
}

const REGIONS: Region[] = [
	{ name: '北海道', prefectures: ['北海道'] },
	{
		name: '東北',
		prefectures: ['青森', '岩手', '宮城', '秋田', '山形', '福島'],
	},
	{
		name: '関東',
		prefectures: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'],
	},
	{
		name: '中部',
		prefectures: [
			'新潟',
			'富山',
			'石川',
			'福井',
			'山梨',
			'長野',
			'岐阜',
			'静岡',
			'愛知',
		],
	},
	{
		name: '近畿',
		prefectures: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'],
	},
	{ name: '中国', prefectures: ['鳥取', '島根', '岡山', '広島', '山口'] },
	{ name: '四国', prefectures: ['徳島', '香川', '愛媛', '高知'] },
	{
		name: '九州',
		prefectures: [
			'福岡',
			'佐賀',
			'長崎',
			'熊本',
			'大分',
			'宮崎',
			'鹿児島',
			'沖縄',
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

	public selectPrefecture(prefecture: string): void {
		this.logger.info('Area selected', { prefecture })
		localStorage.setItem(StorageKeys.userAdminArea, prefecture)
		this.close()
		this.onAreaSelected?.(prefecture)
	}
}
