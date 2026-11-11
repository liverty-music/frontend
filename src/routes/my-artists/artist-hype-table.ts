import { bindable } from 'aurelia'
import type { MyArtist } from './my-artists-route'

/**
 * My Artists' hype table: a header of the four hype levels over one row per
 * followed artist. In edit mode each row's remove button takes the place of
 * its dots. The rows' `hype-changed` and `unfollow-requested` events bubble
 * through this element to the route.
 */
export class ArtistHypeTable {
	@bindable public artists: MyArtist[] = []
	@bindable public editing = false
}
