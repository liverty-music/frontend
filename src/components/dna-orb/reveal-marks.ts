import type { PhysicsBubble } from './bubble-physics'

/**
 * A bubble's artist name is drawn once its opacity exceeds this value, so color
 * fills the bubble before the text bleeds through.
 */
export const LABEL_OPACITY_THRESHOLD = 0.55

/** The cold-load reveal milestones, in the order they fire. */
export type RevealMark = 'ghosts' | 'first-name' | 'all-names'

/**
 * Decides, frame by frame, when the reveal milestones are reached: `ghosts`
 * on the first frame that draws a bubble (a ghost placeholder, or an artist
 * when the artists arrived before any ghost could be drawn), `first-name` on
 * the first artist name drawn, and `all-names` on the first frame where every
 * live bubble is a real artist showing its name. Each milestone fires once.
 * The route decides whether the visit was cold and the timings are reported.
 */
export class RevealMarks {
	private readonly fired = new Set<RevealMark>()

	/** Returns the milestones first reached in this frame's bubbles. */
	public observe(bubbles: readonly PhysicsBubble[]): RevealMark[] {
		if (this.fired.has('all-names')) return []

		let bubbleDrawn = false
		let nameDrawn = false
		let live = 0
		let liveNamed = 0
		for (const b of bubbles) {
			const named = !b.artist.isGhost && b.opacity > LABEL_OPACITY_THRESHOLD
			if (b.opacity >= 0.01) bubbleDrawn = true
			if (named) nameDrawn = true
			if (b.isFadingOut) continue
			live++
			if (named) liveNamed++
		}

		const reached: RevealMark[] = []
		if (!this.fired.has('ghosts')) {
			if (!bubbleDrawn) return reached
			reached.push('ghosts')
		}
		if (!this.fired.has('first-name') && nameDrawn) reached.push('first-name')
		if (live > 0 && liveNamed === live) reached.push('all-names')
		for (const m of reached) this.fired.add(m)
		return reached
	}
}
