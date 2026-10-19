import type { EventProps, Events } from '../../services/analytics-events'

/** A long animation frame entry, with the fields the report reads. */
export interface LongFrameEntry {
	duration: number
	scripts?: readonly { sourceFunctionName?: string; sourceURL?: string }[]
}

/**
 * Turns long animation frames (≥ 100 ms; 50–99 ms are left out to limit
 * volume) into `perf.long_animation_frame` events, at most `limit` per page
 * load. On a slow phone an animated screen (Discovery's canvas) is slow on
 * every frame, and one event per frame then adds analytics work to the very
 * frames it reports.
 */
export function createLongFrameReporter(
	capture: (props: EventProps<typeof Events.LongAnimationFrame>) => void,
	route: () => string,
	limit: number,
): (entries: readonly LongFrameEntry[]) => void {
	let sent = 0
	return (entries) => {
		for (const entry of entries) {
			if (entry.duration < 100) continue
			if (sent >= limit) return
			sent++
			const topScript = entry.scripts?.[0]
			capture({
				duration_ms: Math.round(entry.duration),
				top_function: topScript?.sourceFunctionName ?? '',
				top_script: topScript?.sourceURL ?? '',
				route: route(),
			})
		}
	}
}
