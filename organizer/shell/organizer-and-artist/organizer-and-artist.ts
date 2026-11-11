import { bindable, resolve } from 'aurelia'
import { paths } from '../../model/concert-model'
import type { ArtistChoice } from '../artist-menu/artist-menu'
import { IConsoleContext } from '../console-context'

/**
 * The Organizer's name and the Artist being worked on, in the top app bar:
 * stacked on a compact window, side by side from 600 px. The Artist is the
 * Artist menu (`artist-menu`) when the Organizer represents two or more,
 * its name only with one. Below a destination on a compact window (`deep`)
 * the names keep to the bar's trailing part, so the page title has room.
 */
export class OrganizerAndArtist {
	public readonly context = resolve(IConsoleContext)

	@bindable public deep = false

	/** The represented Artists, each linking to its concerts. */
	public get artists(): ArtistChoice[] {
		const organizer = this.context.organizerId
		return this.context.artists.map((a) => {
			const id = a.id?.value ?? ''
			return {
				id,
				name: a.name?.value ?? '',
				href: paths.concerts({ organizer, artist: id }),
			}
		})
	}

	public get artistName(): string {
		return this.context.artist?.name?.value ?? ''
	}
}
