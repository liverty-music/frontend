import { bindable, customAttribute, INode, resolve } from 'aurelia'
import { artistHue } from '../components/live-highway/color-generator'

/**
 * Bridges JS→CSS for artist-specific coloring.
 * Computes a deterministic hue from the artist name and sets --artist-hue
 * as a CSS custom property on the host element. CSS constructs the full
 * color via hsl(var(--artist-hue), 65%, 60%) and applies it per hype tier.
 *
 * Usage: <div artist-color.bind="event.artistName">
 */
@customAttribute('artist-color')
export class ArtistColorCustomAttribute {
	@bindable() public value = ''

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.applyHue()
	}

	public valueChanged(): void {
		this.applyHue()
	}

	public detaching(): void {
		this.element.style.removeProperty('--artist-hue')
	}

	private applyHue(): void {
		if (this.value) {
			this.element.style.setProperty(
				'--artist-hue',
				String(artistHue(this.value)),
			)
		} else {
			this.element.style.removeProperty('--artist-hue')
		}
	}
}
