/**
 * Persistence adapter for the represented Artist last opened on this device,
 * per Organizer, so 公演 opened from Home or Settings returns to the Artist the
 * operator was working on (design D1, "Choosing the Artist").
 *
 * Keyed by Organizer: a shared device signed in to another Organizer later
 * must not open an Artist it does not represent. A stale id is harmless: the
 * console ignores an Artist that is no longer represented.
 */

const keyFor = (organizerId: string) =>
	`liverty:organizer:last-artist:${organizerId}`

/** Remember the Artist last opened under the Organizer. */
export function saveLastArtistId(organizerId: string, artistId: string): void {
	try {
		localStorage.setItem(keyFor(organizerId), artistId)
	} catch {
		// Private mode or blocked storage: 公演 falls back to the first Artist.
	}
}

/** The Artist last opened under the Organizer on this device, if any. */
export function loadLastArtistId(organizerId: string): string {
	try {
		return localStorage.getItem(keyFor(organizerId)) ?? ''
	} catch {
		return ''
	}
}
