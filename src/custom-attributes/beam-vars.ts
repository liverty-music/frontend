import { bindable, customAttribute, INode, resolve } from 'aurelia'

/**
 * Bridges JS→CSS for laser beam custom properties.
 * Sets --beam-hue, --beam-left, --beam-right on the host element.
 *
 * Usage: <div beam-vars="hue.bind: b.hue; left.bind: b.left; right.bind: b.right">
 */
@customAttribute('beam-vars')
export class BeamVarsCustomAttribute {
	@bindable() public hue = ''
	@bindable() public left = ''
	@bindable() public right = ''

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public hueChanged(): void {
		this.apply()
	}

	public leftChanged(): void {
		this.apply()
	}

	public rightChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--beam-hue')
		this.element.style.removeProperty('--beam-left')
		this.element.style.removeProperty('--beam-right')
	}

	private apply(): void {
		const el = this.element
		el.style.setProperty('--beam-hue', this.hue || '180')
		el.style.setProperty('--beam-left', this.left || '34%')
		el.style.setProperty('--beam-right', this.right || '66%')
	}
}
