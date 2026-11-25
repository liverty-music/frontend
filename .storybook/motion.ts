/**
 * Steps through a finite animation by hand, so a story can assert what a motion
 * does at each point of it instead of reading its CSS. Every finite animation
 * under `root` is paused and set to a share of its own duration (`progress`,
 * 0 to 1, of its delay-free active time); the caller measures, and calls
 * `finishMotion` to let the animations run out again. Endless and
 * scroll-driven animations are left alone.
 */
export function pausableAnimations(root: Element): Animation[] {
	return root
		.getAnimations({ subtree: true })
		.filter(
			(a) =>
				a.effect?.getComputedTiming().iterations !== Infinity &&
				a.timeline instanceof DocumentTimeline,
		)
}

/** Waits for two frames, so what was measured is what has been painted. */
export function nextPaint(): Promise<void> {
	return new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	)
}

export async function seekMotion(
	animations: Animation[],
	progress: number,
): Promise<void> {
	for (const a of animations) {
		const timing = a.effect?.getComputedTiming()
		const total = Number(timing?.endTime ?? 0)
		a.pause()
		a.currentTime = total * progress
	}
	await nextPaint()
}

export function finishMotion(animations: Animation[]): void {
	for (const a of animations) a.finish()
}
