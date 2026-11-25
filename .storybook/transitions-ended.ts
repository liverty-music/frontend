/**
 * Waits until the transitions and animations under `root` have ended, so a
 * story measures, or the accessibility check that follows it reads, the
 * element at rest, not midway through its fade or growth (a half-faded text
 * has no contrast to speak of). Endless animations are left alone.
 */
export async function transitionsEnded(root: Element): Promise<void> {
	await Promise.all(
		root
			.getAnimations({ subtree: true })
			.filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
			.map((a) => a.finished.catch(() => {})),
	)
}
