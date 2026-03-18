import { bindable, customAttribute, INode, resolve } from 'aurelia'
import { artistHueFromColorProfile } from '../components/live-highway/color-generator'
import type { LogoColorProfile } from '../entities/artist'

/**
 * Bridges JS to CSS for artist-specific coloring.
 * Computes an optimal hue from the logo color profile (if available) or
 * a deterministic hash of the artist name, then sets --artist-hue and
 * --artist-bg-lightness as CSS custom properties on the host element.
 *
 * Usage: <div artist-color="event.artistName" profile.bind="event.artist?.fanart?.logoColorProfile">
 */
@customAttribute('artist-color')
export class ArtistColorCustomAttribute {
	@bindable() public value = ''
	@bindable() public profile?: LogoColorProfile

	private readonly element: HTMLElement = resolve(INode) as HTMLElement

	public bound(): void {
		this.apply()
	}

	public valueChanged(): void {
		this.apply()
	}

	public profileChanged(): void {
		this.apply()
	}

	public detaching(): void {
		this.element.style.removeProperty('--artist-hue')
		this.element.style.removeProperty('--artist-bg-lightness')
	}

	private apply(): void {
		if (!this.value) {
			this.element.style.removeProperty('--artist-hue')
			this.element.style.removeProperty('--artist-bg-lightness')
			return
		}

		const hue = artistHueFromColorProfile(this.profile, this.value)
		this.element.style.setProperty('--artist-hue', String(hue))

		if (this.profile) {
			this.element.style.setProperty(
				'--artist-bg-lightness',
				String(this.profile.dominantLightness),
			)
		} else {
			this.element.style.removeProperty('--artist-bg-lightness')
		}
	}
}
