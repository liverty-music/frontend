import { I18N } from '@aurelia/i18n'
import { bindable, INode, resolve } from 'aurelia'
import type { Artist } from '../../entities/artist'
import { dispatchSettling } from '../../util/settling-event'
import type { SearchController } from './search-controller'

/**
 * The artists a Discovery search found. A tap anywhere on a row follows that
 * artist with a `follow` event whose detail is the `artist`; a row already followed shows a check and ignores
 * taps.
 */
export class DiscoverySearchResults {
	public readonly i18n = resolve(I18N)

	/** The route's search state: whether it is searching, and what it found. */
	@bindable public search?: SearchController

	/** The ids of the artists the fan already follows. */
	@bindable public followedIds: ReadonlySet<string> = new Set()

	private readonly host = resolve(INode) as HTMLElement

	/**
	 * A row is a `li` with the button role, so a key is not a click: Enter or
	 * Space on a focused row follows that artist, as a native button does.
	 */
	public pressWithKey(event: KeyboardEvent): boolean {
		const row = (event.target as Element | null)?.closest('.result-item')
		if (row && (event.key === 'Enter' || event.key === ' ') && !event.repeat) {
			event.preventDefault()
			;(row as HTMLElement).click()
			return false
		}
		return true
	}

	/**
	 * Asks the parent to follow an artist with a `follow` event. The row stays
	 * busy until the promise the parent passes to `waitUntil` settles.
	 */
	public follow(artist: Artist): Promise<unknown> | undefined {
		return dispatchSettling(this.host, 'follow', { artist })
	}
}
