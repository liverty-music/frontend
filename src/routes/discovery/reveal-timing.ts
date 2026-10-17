import type { RevealMark } from '../../components/dna-orb/reveal-marks'
import type { DiscoveryRevealProps } from '../../services/analytics-events'

export type RevealEntry = DiscoveryRevealProps['entry']

/** The timings of one cold visit, ready to be combined with the load path. */
export type RevealTimings = Pick<
	DiscoveryRevealProps,
	'entry' | 'ghosts_ms' | 'first_name_ms' | 'all_names_ms'
>

// Set by the first Discovery entry of this document.
let discoveryEntered = false

/**
 * Whether this Discovery entry is the document's first route: the first
 * Discovery entry of the document, at the address the document was loaded at.
 * An entry after an in-app navigation (from another route, or a return to
 * Discovery) is `in_app`.
 */
export function detectRevealEntry(): RevealEntry {
	const first = !discoveryEntered
	discoveryEntered = true
	if (!first) return 'in_app'
	const nav = performance.getEntriesByType('navigation')[0]
	if (!nav) return 'in_app'
	return new URL(nav.name).pathname === window.location.pathname
		? 'page_load'
		: 'in_app'
}

/** Test seam: forget the first Discovery entry of this document. */
export function resetRevealEntryForTests(): void {
	discoveryEntered = false
}

/**
 * Collects the cold-load reveal marks of one Discovery visit and yields the
 * timings once, when every bubble shows an artist name. Times are relative to
 * `openedAt` (both in `performance.now()` milliseconds).
 */
export class RevealTiming {
	private readonly marks = new Map<RevealMark, number>()

	constructor(
		public readonly entry: RevealEntry,
		private readonly openedAt: number,
	) {}

	/** Record a mark; returns the timings when the last mark completes them. */
	public record(mark: RevealMark, time: number): RevealTimings | null {
		this.marks.set(mark, time)
		const ghosts = this.marks.get('ghosts')
		const firstName = this.marks.get('first-name')
		const allNames = this.marks.get('all-names')
		if (
			ghosts === undefined ||
			firstName === undefined ||
			allNames === undefined
		) {
			return null
		}
		return {
			entry: this.entry,
			ghosts_ms: Math.round(ghosts - this.openedAt),
			first_name_ms: Math.round(firstName - this.openedAt),
			all_names_ms: Math.round(allNames - this.openedAt),
		}
	}
}
