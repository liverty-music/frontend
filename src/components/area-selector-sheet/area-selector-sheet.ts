import { bindable, ILogger, INode, resolve } from 'aurelia'

const REGION_STORAGE_KEY = 'liverty-music:user-region'

// Region → Prefecture mapping for Japan
const REGIONS: Record<string, string[]> = {
	北海道: ['北海道'],
	東北: ['青森', '岩手', '宮城', '秋田', '山形', '福島'],
	関東: ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川'],
	中部: [
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
	近畿: ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山'],
	中国: ['鳥取', '島根', '岡山', '広島', '山口'],
	四国: ['徳島', '香川', '愛媛', '高知'],
	九州: ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'],
}

const REGION_NAMES = Object.keys(REGIONS)

export class AreaSelectorSheet {
	@bindable public onAreaSelected?: (prefecture: string) => void

	public isOpen = false
	public selectedRegion = ''
	public regionNames = REGION_NAMES
	public prefectures: string[] = []

	private readonly logger = resolve(ILogger).scopeTo('AreaSelectorSheet')
	private readonly element = resolve(INode) as HTMLElement
	private touchStartY = 0
	public isDragging = false
	private dragOffset = 0
	private scrollableEl: Element | null = null
	private readonly DISMISS_THRESHOLD = 100

	public static getStoredArea(): string | null {
		return localStorage.getItem(REGION_STORAGE_KEY)
	}

	public open(): void {
		this.isOpen = true
		this.selectedRegion = ''
		this.prefectures = []
		this.dragOffset = 0
		this.scrollableEl = this.element.querySelector('.overflow-y-auto')
	}

	public close(): void {
		this.isOpen = false
		this.dragOffset = 0
	}

	public selectRegion(region: string): void {
		this.selectedRegion = region
		this.prefectures = REGIONS[region] ?? []
	}

	public selectPrefecture(prefecture: string): void {
		this.logger.info('Area selected', { prefecture })
		localStorage.setItem(REGION_STORAGE_KEY, prefecture)
		this.close()
		this.onAreaSelected?.(prefecture)
	}

	public goBackToRegions(): void {
		this.selectedRegion = ''
		this.prefectures = []
	}

	public get sheetTransform(): string {
		if (!this.isOpen) return 'transform: translateY(100%)'
		if (this.dragOffset > 0)
			return `transform: translateY(${this.dragOffset}px)`
		return ''
	}

	public onTouchStart(e: TouchEvent): void {
		if (!this.isOpen) return
		this.touchStartY = e.touches[0].clientY
		this.isDragging = true
	}

	public onTouchMove(e: TouchEvent): void {
		if (!this.isDragging) return
		if (this.scrollableEl && this.scrollableEl.scrollTop > 0) {
			this.isDragging = false
			this.dragOffset = 0
			return
		}
		const deltaY = e.touches[0].clientY - this.touchStartY
		if (deltaY <= 0) {
			this.isDragging = false
			this.dragOffset = 0
			return
		}
		e.preventDefault()
		this.dragOffset = deltaY
	}

	public onTouchEnd(): void {
		if (!this.isDragging) return
		this.isDragging = false

		if (this.dragOffset > this.DISMISS_THRESHOLD) {
			this.close()
		} else {
			this.dragOffset = 0
		}
	}
}
