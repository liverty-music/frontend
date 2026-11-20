import { bindable } from 'aurelia'

/** One beam: the view timeline it follows, its hue and its foot's edges. */
export interface LaserBeam {
	timeline: string
	hue: number
	left: string
	right: string
}

/**
 * The laser beams over the timetable's lanes, one per matched concert.
 * Placed on the highway's overlay `<div>` with `as-element`; the highway
 * builds the set and puts each beam's timeline name in scope.
 */
export class LaserBeams {
	@bindable public beams: LaserBeam[] = []
}
