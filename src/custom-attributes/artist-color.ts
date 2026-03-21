import { bindable, customAttribute, INode, resolve } from 'aurelia'
import { artistHue } from '../adapter/view/artist-color'

/**
 * Sets --artist-hue CSS custom property from a deterministic name hash.
 *
 * Usage: <div artist-color.bind="artistName">
 */
@customAttribute('artist-color')
export class ArtistColorCustomAttribute {
	@bindable() public value = ''

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--artist-hue')
	}

	private apply(): void {
		if (!this.value) {
			this.element.style.removeProperty('--artist-hue')
			return
		}
		this.element.style.setProperty(
			'--artist-hue',
			String(artistHue(this.value)),
		)
	}
}
