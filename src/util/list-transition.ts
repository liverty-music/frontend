/**
 * Runs an in-place edit of a list (a row removed or restored, a mode switched)
 * as a View Transition. Rows and bars that have a `view-transition-name`
 * animate on their own: one fades out or in, the rest move to their new
 * places. The default `root` cross-fade, a route-level effect, is suppressed
 * while it runs (`vt-suppress-root`, global.css): otherwise the header and the
 * bottom navigation, unnamed and captured in `root`, dip in opacity and read
 * as disappearing.
 *
 * Where the browser has no View Transitions the edit is made at once, and
 * under reduced motion a global rule stops the animation. Resolves once the
 * edit has been made.
 */
let latest: ViewTransition | null = null

export async function inListTransition(change: () => void): Promise<void> {
	if (typeof document.startViewTransition !== 'function') {
		change()
		return
	}
	document.documentElement.classList.add('vt-suppress-root')
	const transition = document.startViewTransition(change)
	latest = transition
	// The browser can skip the transition and reject `ready`; the edit is
	// still made, without the animation.
	void transition.ready.catch(() => {})
	void transition.finished.finally(() => {
		// A newer transition skips this one; it keeps the class until it ends.
		if (latest !== transition) return
		latest = null
		document.documentElement.classList.remove('vt-suppress-root')
	})
	await transition.updateCallbackDone
}
