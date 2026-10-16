/**
 * Persistence adapter for the fan's in-progress checkout of an event, so
 * reopening the checkout (a reload, or the page opened again in another tab)
 * resumes the same hold with its countdown instead of starting over.
 *
 * localStorage, not sessionStorage: reopening the checkout from another tab is
 * also a resume. A stale entry is harmless: the checkout reads the
 * Checkout and starts over when it no longer holds tickets.
 */

const keyFor = (eventId: string) => `checkout:${eventId}`

/** Remember the Checkout the fan is checking out with for the event. */
export function saveCheckoutId(eventId: string, checkoutId: string): void {
	try {
		localStorage.setItem(keyFor(eventId), checkoutId)
	} catch {
		// Private mode or blocked storage: the checkout still works, it just
		// cannot resume after a reload.
	}
}

/** The Checkout the fan was checking out with for the event, if any. */
export function loadCheckoutId(eventId: string): string | null {
	try {
		return localStorage.getItem(keyFor(eventId))
	} catch {
		return null
	}
}

/** Forget the event's checkout once it completed or can no longer resume. */
export function clearCheckoutId(eventId: string): void {
	try {
		localStorage.removeItem(keyFor(eventId))
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}
