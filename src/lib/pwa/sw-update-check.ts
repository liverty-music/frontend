/**
 * Service Worker update checks.
 *
 * `registration.update()` rejects when the browser cannot fetch `/sw.js`, for
 * example when an iOS PWA resumes before the network is back. A failed check
 * needs no action: the next resume or page load checks again. So each check
 * catches its own rejection and never reaches the global
 * `unhandledrejection` handler.
 */
export function checkForServiceWorkerUpdates(registration: {
	update(): Promise<unknown>
}): void {
	const check = (): void => {
		registration.update().catch(() => {})
	}
	check()
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') check()
	})
}
