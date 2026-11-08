/**
 * A bubble's artist name is drawn once its opacity exceeds this value, so color
 * fills the bubble before the text bleeds through.
 */
export const LABEL_OPACITY_THRESHOLD = 0.55

/** The cold-load reveal milestones, in the order they fire. */
export type RevealMark = 'ghosts' | 'first-name' | 'all-names'

/** What one frame drew, counted by the canvas while it draws the bubbles. */
export interface RevealFrame {
	/** Bubbles drawn on screen (a ghost or an artist body). */
	drawn: number
	/** Artist names drawn on screen. */
	named: number
	/** Bubbles not fading out. */
	live: number
	/** Bubbles not fading out whose artist name was drawn. */
	liveNamed: number
}

/** A frame that drew nothing. */
export function emptyRevealFrame(): RevealFrame {
	return { drawn: 0, named: 0, live: 0, liveNamed: 0 }
}

/**
 * Decides, frame by frame, when the reveal milestones are reached: `ghosts`
 * on the first frame that draws a bubble (a ghost placeholder, or an artist
 * when the artists arrived before any ghost could be drawn), `first-name` on
 * the first frame that draws an artist name, and `all-names` on the first
 * frame that draws the name of every live bubble. A name counts in the frame
 * that puts it on screen, whether it is pasted from a sprite or drawn
 * directly. Each milestone fires once. The route decides whether the visit was
 * cold and the timings are reported.
 */
export class RevealMarks {
	private readonly fired = new Set<RevealMark>()

	/** Whether every milestone has fired, so frames need no more counting. */
	public get done(): boolean {
		return this.fired.has('all-names')
	}

	/** Returns the milestones first reached in this frame. */
	public observe(frame: RevealFrame): RevealMark[] {
		if (this.done) return []

		const reached: RevealMark[] = []
		if (!this.fired.has('ghosts')) {
			if (frame.drawn === 0) return reached
			reached.push('ghosts')
		}
		if (!this.fired.has('first-name') && frame.named > 0) {
			reached.push('first-name')
		}
		if (frame.live > 0 && frame.liveNamed === frame.live) {
			reached.push('all-names')
		}
		for (const m of reached) this.fired.add(m)
		return reached
	}
}
