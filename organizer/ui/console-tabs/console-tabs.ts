import { bindable } from 'aurelia'

export interface ConsoleTab {
	id: string
	/** Catalog key of the tab's label, translated in the tabs' template. */
	labelKey: string
	href: string
}

/**
 * M3 primary tabs that drive the router: each tab is a link to its own
 * address, so a tab can be shared. The indicator slides to the selected tab
 * (medium2, standard easing); under reduced motion the duration token is 0 ms
 * and it moves at once.
 */
export class ConsoleTabs {
	@bindable public tabs: ConsoleTab[] = []
	@bindable public active = ''
	@bindable public label = ''

	public indicatorStart = 0
	public indicatorSize = 0
	public list!: HTMLElement

	/** Position of the indicator under the selected tab, as custom properties. */
	public get indicatorStyle(): string {
		return `--indicator-start: ${this.indicatorStart}px; --indicator-size: ${this.indicatorSize}px`
	}

	private observer: ResizeObserver | null = null

	public attached(): void {
		this.measure()
		this.observer = new ResizeObserver(() => this.measure())
		this.observer.observe(this.list)
		// A tab's width changes with its label, e.g. on a language switch.
		for (const tab of this.list.querySelectorAll('[data-tab]')) {
			this.observer.observe(tab)
		}
	}

	public detaching(): void {
		this.observer?.disconnect()
		this.observer = null
	}

	public activeChanged(): void {
		// The selected link's attribute updates in the same flush; measure after.
		queueMicrotask(() => this.measure())
	}

	private measure(): void {
		if (!this.list) return
		const current = this.list.querySelector<HTMLElement>(
			'[aria-current="page"]',
		)
		if (!current) {
			this.indicatorSize = 0
			return
		}
		this.indicatorStart = current.offsetLeft
		this.indicatorSize = current.offsetWidth
	}
}
