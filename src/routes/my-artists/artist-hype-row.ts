import { bindable, INode, resolve } from 'aurelia'
import { HYPE_TIERS } from '../../adapter/view/hype-display'
import type { Hype } from '../../entities/follow'
import type { MyArtist } from './my-artists-route'

/** Detail of the `hype-changed` event: the artist and the level picked. */
export interface HypeChangedDetail {
	artist: MyArtist
	level: Hype
}

/** Detail of the `unfollow-requested` event. */
export interface UnfollowRequestedDetail {
	artist: MyArtist
}

/**
 * An artist's row of the hype table: the name, then either the four hype
 * dots or, in edit mode, the remove button in their place. It renders on
 * `<tr as-element="artist-hype-row">`, so the row stays a table row. It tells
 * the route through bubbling `hype-changed` and `unfollow-requested` events.
 */
export class ArtistHypeRow {
	@bindable public artist!: MyArtist
	@bindable public editing = false

	public readonly hypeLevels: Hype[] = ['watch', 'home', 'nearby', 'away']
	/** Each level's label, the accessible name of its radio button. */
	public readonly hypeTiers = HYPE_TIERS

	private readonly element = resolve(INode) as HTMLElement

	public hypeChanged(level: Hype): void {
		this.element.dispatchEvent(
			new CustomEvent<HypeChangedDetail>('hype-changed', {
				bubbles: true,
				detail: { artist: this.artist, level },
			}),
		)
		// The page has answered by now, synchronously: it keeps the pick, or
		// puts `artist.hype` back. A pick put back in the same turn leaves the
		// dots' `active` as it was, so their radios would not hear of it; this
		// makes every radio of the row follow `artist.hype` again.
		this.element
			.querySelectorAll<HTMLInputElement>('input[type="radio"]')
			.forEach((radio, i) => {
				radio.checked = this.hypeLevels[i] === this.artist.hype
			})
	}

	public unfollow(): void {
		this.element.dispatchEvent(
			new CustomEvent<UnfollowRequestedDetail>('unfollow-requested', {
				bubbles: true,
				detail: { artist: this.artist },
			}),
		)
	}
}
