import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for indicator dot color.
 * Sets --_dot-color as a CSS custom property on the host element.
 * CSS consumes via `background-color: var(--_dot-color)`.
 *
 * Usage: <span dot-color.bind="artist.color">
 */
@customAttribute('dot-color')
export class DotColorCustomAttribute {
	@bindable() public value = ''

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--_dot-color')
	}

	private apply(): void {
		if (this.value) {
			this.element.style.setProperty('--_dot-color', this.value)
		} else {
			this.element.style.removeProperty('--_dot-color')
		}
	}
}
