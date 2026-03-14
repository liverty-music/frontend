import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for vertical drag offset.
 * Sets --_drag-y as a CSS custom property on the host element.
 * CSS consumes via `translate: 0 var(--_drag-y, 0)`.
 *
 * Usage: <dialog drag-offset.bind="dragOffset">
 */
@customAttribute('drag-offset')
export class DragOffsetCustomAttribute {
	@bindable() public value = 0

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--_drag-y')
	}

	private apply(): void {
		if (this.value > 0) {
			this.element.style.setProperty('--_drag-y', `${this.value}px`)
		} else {
			this.element.style.removeProperty('--_drag-y')
		}
	}
}
