import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for tile background color.
 * Sets --_tile-color as a CSS custom property on the host element.
 * CSS consumes via `color-mix(in oklch, var(--_tile-color) 25%, transparent)`.
 *
 * Usage: <div tile-color.bind="artist.color">
 */
@customAttribute('tile-color')
export class TileColorCustomAttribute {
	@bindable() public value = ''

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--_tile-color')
	}

	private apply(): void {
		if (this.value) {
			this.element.style.setProperty('--_tile-color', this.value)
		} else {
			this.element.style.removeProperty('--_tile-color')
		}
	}
}
