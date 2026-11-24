import { bindable, customAttribute, INode, resolve } from 'aurelia'

/** The item that is the group's one Tab stop: the one marked current or selected. */
const CURRENT =
	'[aria-current]:not([aria-current="false"]), [aria-checked="true"], [aria-pressed="true"], [data-selected="true"], :checked'

/**
 * A group of controls that is one Tab stop, with the arrow keys moving between
 * its items (WAI-ARIA "roving tabindex"; Material 3 tabs, chips and radio
 * groups: Tab enters and leaves the group, the arrows move inside it). The
 * value is the selector of the items; Home and End go to the first and last,
 * and the arrows wrap. The current item (the one marked current, selected or
 * checked, else the first) takes `tabindex="0"` and the others `-1`; focusing
 * an item makes it the stop.
 *
 * Put it on the container, not on every item: one listener serves the group,
 * and a mutation observer keeps the stop right as items come and go.
 *
 * Usage: <nav roving-focus="a">…</nav>
 */
@customAttribute('roving-focus')
export class RovingFocusCustomAttribute {
	@bindable() public value = ''

	private readonly element = resolve(INode) as HTMLElement
	private observer: MutationObserver | null = null

	public attached(): void {
		this.element.addEventListener('keydown', this.onKeydown)
		this.element.addEventListener('focusin', this.onFocusin)
		this.observer = new MutationObserver(() => this.apply())
		this.observer.observe(this.element, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				'aria-current',
				'aria-checked',
				'aria-pressed',
				'data-selected',
				'aria-disabled',
				'disabled',
			],
		})
		this.apply()
	}

	public detaching(): void {
		this.element.removeEventListener('keydown', this.onKeydown)
		this.element.removeEventListener('focusin', this.onFocusin)
		this.observer?.disconnect()
		this.observer = null
	}

	private all(): HTMLElement[] {
		if (!this.value) return []
		return [...this.element.querySelectorAll<HTMLElement>(this.value)]
	}

	private available(items: HTMLElement[]): HTMLElement[] {
		return items.filter(
			(item) =>
				!item.hasAttribute('disabled') &&
				item.getAttribute('aria-disabled') !== 'true',
		)
	}

	private items(): HTMLElement[] {
		return this.available(this.all())
	}

	/** Make `stop` the one Tab stop. Setting an unchanged value does nothing. */
	private setStop(items: HTMLElement[], stop: HTMLElement | undefined): void {
		for (const item of items) {
			const value = item === stop ? '0' : '-1'
			if (item.getAttribute('tabindex') !== value) {
				item.setAttribute('tabindex', value)
			}
		}
	}

	private apply(): void {
		const items = this.items()
		// An item that has become unavailable (disabled, or followed) is no
		// longer a stop, whatever it was.
		for (const item of this.all()) {
			if (!items.includes(item) && item.getAttribute('tabindex') === '0') {
				item.setAttribute('tabindex', '-1')
			}
		}
		const focused = items.find((item) => item === document.activeElement)
		const stop =
			focused ??
			items.find((item) => item.matches(CURRENT)) ??
			items.find((item) => item.getAttribute('tabindex') === '0') ??
			items[0]
		this.setStop(items, stop)
	}

	private readonly onFocusin = (event: FocusEvent): void => {
		const items = this.items()
		const target = items.find((item) => item.contains(event.target as Node))
		if (target) this.setStop(items, target)
	}

	private readonly onKeydown = (event: KeyboardEvent): void => {
		if (event.altKey || event.ctrlKey || event.metaKey) return
		const items = this.items()
		const at = items.findIndex((item) => item.contains(event.target as Node))
		if (at < 0) return
		let next = at
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				next = (at + 1) % items.length
				break
			case 'ArrowLeft':
			case 'ArrowUp':
				next = (at - 1 + items.length) % items.length
				break
			case 'Home':
				next = 0
				break
			case 'End':
				next = items.length - 1
				break
			default:
				return
		}
		event.preventDefault()
		this.setStop(items, items[next])
		items[next].focus()
	}
}
