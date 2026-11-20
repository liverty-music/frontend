import type { DiscoveryFramesProps } from '../../services/analytics-events'

/** A visit with fewer measured frames sends no frame-timing event. */
export const MIN_FRAME_SAMPLES = 30
/** Samples kept per visit: about one minute at 60 frames per second. */
export const MAX_FRAME_SAMPLES = 3600

/** The frame figures of one visit, before the canvas adds its own state. */
export type FrameSummary = Pick<
	DiscoveryFramesProps,
	'frames' | 'interval_p50_ms' | 'interval_p95_ms' | 'longest_ms' | 'over_50ms'
>

/**
 * The frame intervals of one Discovery visit. The canvas records an interval
 * only for a frame of its running loop, so paused time (search mode, the All
 * Nearby view, a hidden page) is never recorded. `finish` ends the visit once.
 */
export class FrameTimings {
	private readonly samples: number[] = []
	private finished = false

	/** Record one frame interval in ms; later samples past the cap are dropped. */
	public record(intervalMs: number): void {
		if (this.finished || intervalMs <= 0) return
		if (this.samples.length >= MAX_FRAME_SAMPLES) return
		this.samples.push(intervalMs)
	}

	/**
	 * End the visit: the figures the first time it is called with enough
	 * samples, null otherwise and on every later call.
	 */
	public finish(): FrameSummary | null {
		if (this.finished) return null
		this.finished = true
		const n = this.samples.length
		if (n < MIN_FRAME_SAMPLES) return null
		const sorted = [...this.samples].sort((a, b) => a - b)
		const at = (p: number) => sorted[Math.min(n - 1, Math.floor(n * p))]
		return {
			frames: n,
			interval_p50_ms: round1(at(0.5)),
			interval_p95_ms: round1(at(0.95)),
			longest_ms: Math.round(sorted[n - 1]),
			over_50ms: this.samples.filter((s) => s > 50).length,
		}
	}
}

function round1(ms: number): number {
	return Math.round(ms * 10) / 10
}
