import { bindable, ILogger, resolve } from 'aurelia'

const REGION_STORAGE_KEY = 'liverty-music:user-region'

const PREFECTURES = [
	'北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島',
	'茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
	'新潟', '富山', '石川', '福井', '山梨', '長野',
	'岐阜', '静岡', '愛知', '三重',
	'滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
	'鳥取', '島根', '岡山', '広島', '山口',
	'徳島', '香川', '愛媛', '高知',
	'福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄',
]

const QUICK_SELECT_CITIES = ['東京', '大阪', '名古屋', '福岡', '札幌', '仙台']

// Map quick-select city names to their prefecture
const CITY_TO_PREFECTURE: Record<string, string> = {
	'東京': '東京',
	'大阪': '大阪',
	'名古屋': '愛知',
	'福岡': '福岡',
	'札幌': '北海道',
	'仙台': '宮城',
}

export class RegionSetupSheet {
	@bindable public onRegionSelected?: (region: string) => void

	public isOpen = false
	public prefectures = PREFECTURES
	public quickCities = QUICK_SELECT_CITIES
	public selectedPrefecture = ''

	private readonly logger = resolve(ILogger).scopeTo('RegionSetupSheet')

	public static getStoredRegion(): string | null {
		return localStorage.getItem(REGION_STORAGE_KEY)
	}

	public open(): void {
		this.isOpen = true
		this.selectedPrefecture = ''
	}

	public close(): void {
		this.isOpen = false
	}

	public selectQuickCity(city: string): void {
		const prefecture = CITY_TO_PREFECTURE[city] ?? city
		this.saveRegion(prefecture)
	}

	public selectPrefecture(): void {
		if (!this.selectedPrefecture) return
		this.saveRegion(this.selectedPrefecture)
	}

	private saveRegion(prefecture: string): void {
		this.logger.info('Region selected', { prefecture })
		localStorage.setItem(REGION_STORAGE_KEY, prefecture)
		this.close()
		this.onRegionSelected?.(prefecture)
	}
}
