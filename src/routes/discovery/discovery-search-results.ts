import { I18N } from '@aurelia/i18n'
import { bindable, resolve } from 'aurelia'
import type { Artist } from '../../entities/artist'
import type { SearchController } from './search-controller'

/**
 * The artists a Discovery search found. A tap anywhere on a row follows that
 * artist through `onFollow`; a row already followed shows a check and ignores
 * taps.
 */
export class DiscoverySearchResults {
	public readonly i18n = resolve(I18N)

	/** The route's search state: whether it is searching, and what it found. */
	@bindable public search?: SearchController

	/** The ids of the artists the fan already follows. */
	@bindable public followedIds: ReadonlySet<string> = new Set()

	/** Follows an artist; the row stays busy until it settles. */
	@bindable public onFollow?: (artist: Artist) => Promise<void>
}
