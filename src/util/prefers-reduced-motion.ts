const QUERY = '(prefers-reduced-motion: reduce)'

/** Returns true when the user has requested reduced motion (SSR/test-safe). */
export function prefersReducedMotion(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia(QUERY).matches
	)
}

/**
 * Subscribe to live changes of the reduced-motion preference. Invokes
 * `onChange` with the new value whenever the OS setting flips. Returns an
 * unsubscribe function (no-op where matchMedia is unavailable).
 */
export function onReducedMotionChange(
	onChange: (reduced: boolean) => void,
): () => void {
	if (
		typeof window === 'undefined' ||
		typeof window.matchMedia !== 'function'
	) {
		return () => {}
	}
	const mql = window.matchMedia(QUERY)
	const handler = (e: MediaQueryListEvent): void => onChange(e.matches)
	mql.addEventListener('change', handler)
	return () => mql.removeEventListener('change', handler)
}
