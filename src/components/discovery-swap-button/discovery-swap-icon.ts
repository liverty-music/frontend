import { bindable } from 'aurelia'
import type { DiscoveryView } from '../../adapter/storage/discovery-view-storage'

/**
 * The swap tile's drawing: two arrows in a loop, the glyph of the view on
 * screen large over them and the glyph of the other view on the corner badge.
 * Decoration only; the tile's button carries the name.
 */
export class DiscoverySwapIcon {
	/** The view on screen; its glyph is drawn large. */
	@bindable public view: DiscoveryView = 'artists'

	/** Half turns the arrows have made, multiplied by 180deg in the stylesheet. */
	@bindable public turn = 0
}
