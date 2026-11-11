import { bindable } from 'aurelia'

/** One represented Artist in the Artist menu. */
export interface ArtistChoice {
	readonly id: string
	readonly name: string
	readonly href: string
}

/**
 * The Artist menu in the top app bar (M3 menu button), shown when the
 * Organizer represents two or more Artists: the Artist being worked on and a
 * drop-down arrow, opening the represented Artists, each linking to its
 * concerts. The current one carries the check.
 */
export class ArtistMenu {
	@bindable public artists: ArtistChoice[] = []
	@bindable public currentId = ''
	@bindable public currentName = ''

	public menu!: HTMLElement

	/** Closes the menu; the chosen link navigates. */
	public choose(): boolean {
		this.menu.hidePopover()
		return true
	}
}
