/**
 * Persistence adapter for the fan's in-progress checkout of an event, so
 * reopening the checkout (a reload, or the page opened again in another tab)
 * resumes the same hold with its countdown instead of starting over.
 *
 * localStorage, not sessionStorage: reopening the checkout from another tab is
 * also a resume. A stale entry is harmless: the checkout reads the
 * Reservation and starts over when it no longer holds tickets.
 */

const keyFor = (eventId: string) => `liverty:checkout:${eventId}`

/** Remember the Reservation the fan is checking out with for the event. */
export function saveCheckoutReservation(
	eventId: string,
	reservationId: string,
): void {
	try {
		localStorage.setItem(keyFor(eventId), reservationId)
	} catch {
		// Private mode or blocked storage: the checkout still works, it just
		// cannot resume after a reload.
	}
}

/** The Reservation the fan was checking out with for the event, if any. */
export function loadCheckoutReservation(eventId: string): string | null {
	try {
		return localStorage.getItem(keyFor(eventId))
	} catch {
		return null
	}
}

/** Forget the event's checkout once it completed or can no longer resume. */
export function clearCheckoutReservation(eventId: string): void {
	try {
		localStorage.removeItem(keyFor(eventId))
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}
