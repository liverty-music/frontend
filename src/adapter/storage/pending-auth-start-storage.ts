/**
 * Persistence adapter for a start of sign-up or sign-in that happened before
 * the analytics library loaded. The page leaves for hosted login at once, so
 * the event is kept here and sent with its own time when the person comes
 * back (OpenSpec `sign-up-or-sign-in`, "Started before analytics loaded").
 *
 * sessionStorage, not localStorage: the return from hosted login lands in the
 * same tab, and a start left behind in another tab is not this person's.
 */

const KEY = 'analytics:pending-auth-start'

/** A start of sign-up or sign-in waiting to be reported. */
export interface PendingAuthStart {
	readonly kind: string
	readonly source: string
	/** When the start happened, in milliseconds since the epoch. */
	readonly time: number
}

/** Keep a start to report when the analytics library has loaded. */
export function savePendingAuthStart(start: PendingAuthStart): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(start))
	} catch {
		// Private mode or blocked storage: the start goes unreported.
	}
}

/** The kept start, removed so it is reported once; null when there is none. */
export function takePendingAuthStart(): PendingAuthStart | null {
	try {
		const raw = sessionStorage.getItem(KEY)
		sessionStorage.removeItem(KEY)
		if (raw === null) return null
		const value = JSON.parse(raw) as Partial<PendingAuthStart>
		if (
			typeof value.kind !== 'string' ||
			typeof value.source !== 'string' ||
			typeof value.time !== 'number'
		) {
			return null
		}
		return { kind: value.kind, source: value.source, time: value.time }
	} catch {
		return null
	}
}
