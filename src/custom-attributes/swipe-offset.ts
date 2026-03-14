import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for horizontal swipe offset.
 * Sets --_swipe-x as a CSS custom property on the host element.
 * CSS consumes via `translate: var(--_swipe-x, 0) 0`.
 *
 * Usage: <div swipe-offset.bind="offset">
 */
@customAttribute('swipe-offset')
export class SwipeOffsetCustomAttribute {
	@bindable() public value = 0

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--_swipe-x')
	}

	private apply(): void {
		this.element.style.setProperty('--_swipe-x', `${this.value}px`)
	}
}
