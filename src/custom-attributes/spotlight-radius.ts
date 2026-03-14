import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for coach-mark spotlight radius.
 * Sets --spotlight-radius as a CSS custom property on the host element.
 *
 * Usage: <div spotlight-radius.bind="radius">
 */
@customAttribute('spotlight-radius')
export class SpotlightRadiusCustomAttribute {
	@bindable() public value = '12px'

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--spotlight-radius')
	}

	private apply(): void {
		this.element.style.setProperty('--spotlight-radius', this.value)
	}
}
