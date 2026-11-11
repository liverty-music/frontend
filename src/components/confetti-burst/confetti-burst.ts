import { bindable } from 'aurelia'
import type { ConfettiPiece } from '../celebration-overlay/celebration-overlay'

/**
 * One burst of confetti from the centre of the screen, over the celebration
 * overlay. Each piece's flight comes from `makeConfetti`; with reduced motion
 * the burst is not shown.
 */
export class ConfettiBurst {
	@bindable public pieces: ConfettiPiece[] = []
}
