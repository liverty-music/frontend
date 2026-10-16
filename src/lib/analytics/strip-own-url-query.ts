/**
 * Removes the query string and the fragment from every address on the app's
 * own origin in an analytics event, so a referral code (`?ref=`) or any later
 * link value never leaves the device (OpenSpec `referral-attribution`, design
 * D11). Addresses on other origins, such as an external `$referrer`, are kept
 * as they are.
 *
 * Matching is by value, not by a fixed list of property names: the SDK adds
 * the current address and first-visit addresses under several keys
 * (`$current_url`, `$initial_current_url`, `$session_entry_url`, …), in the
 * event's `properties` and in its `$set` / `$set_once` person properties.
 *
 * Pure: the event is not mutated; a copy is returned.
 */

/** The parts of a PostHog capture result this filter reads and rewrites. */
export interface AnalyticsEventLike {
	properties?: Record<string, unknown>
	$set?: Record<string, unknown>
	$set_once?: Record<string, unknown>
}

/** Nesting depth walked below each top-level property bag. */
const MAX_DEPTH = 4

export function stripOwnUrlQuery<T extends AnalyticsEventLike>(
	event: T | null,
	origin: string,
): T | null {
	if (event === null) return null
	const out: AnalyticsEventLike = { ...event }
	if (event.properties)
		out.properties = stripRecord(event.properties, origin, 0)
	if (event.$set) out.$set = stripRecord(event.$set, origin, 0)
	if (event.$set_once) out.$set_once = stripRecord(event.$set_once, origin, 0)
	return out as T
}

function stripRecord(
	record: Record<string, unknown>,
	origin: string,
	depth: number,
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(record)) {
		out[key] = stripValue(value, origin, depth)
	}
	return out
}

function stripValue(value: unknown, origin: string, depth: number): unknown {
	if (typeof value === 'string') return stripUrl(value, origin)
	if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
		return value
	}
	if (Array.isArray(value)) {
		return value.map((v) => stripValue(v, origin, depth + 1))
	}
	if (Object.getPrototypeOf(value) === Object.prototype) {
		return stripRecord(value as Record<string, unknown>, origin, depth + 1)
	}
	return value
}

/** The address without query and fragment when it is on `origin`. */
function stripUrl(value: string, origin: string): string {
	if (!value.startsWith(origin)) return value
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return value
	}
	if (url.origin !== origin || (url.search === '' && url.hash === '')) {
		return value
	}
	url.search = ''
	url.hash = ''
	return url.toString()
}
