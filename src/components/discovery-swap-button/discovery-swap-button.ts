import { bindable } from 'aurelia'
import type { DiscoveryView } from '../../adapter/storage/discovery-view-storage'

export type { DiscoveryView }

/**
 * The swap tile beside the Discovery orb. Its icon draws two arrows in a loop
 * with the glyph of the view on screen large over them and the glyph of the
 * other view as a small corner badge; the label under it names the view a tap
 * leads to. The caller owns the view and decides what a tap does (`onSwap`).
 */
export class DiscoverySwapButton {
	/** The view on screen. */
	@bindable public view: DiscoveryView = 'artists'

	/** Invoked on a tap; the caller switches the view. */
	@bindable public onSwap?: () => void

	/**
	 * Half turns the arrows have made, accumulated so they always turn the same
	 * way (a toggle between two angles would turn back on every other tap).
	 * Multiplied by 180deg in the stylesheet.
	 */
	public ringTurn = 0

	/** The label names the destination, not the view on screen. */
	public get labelKey(): string {
		return this.view === 'nearby'
			? 'discovery.swap.toArtists'
			: 'discovery.swap.toNearby'
	}

	public viewChanged(next: DiscoveryView, previous: DiscoveryView): void {
		if (next !== previous) this.ringTurn += 1
	}

	public swap(): void {
		this.onSwap?.()
	}
}
