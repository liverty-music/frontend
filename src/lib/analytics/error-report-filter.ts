import { redactSecrets } from './redact-secrets'
import {
	type AnalyticsEventLike,
	stripOwnUrlQuery,
} from './strip-own-url-query'

/**
 * Query keys an error report keeps on its current address: the dashboard's
 * filter state (selected artists, journey stage, entry point). An error on a
 * filtered dashboard cannot be reproduced without them, and none of them is
 * personal or referral data (OpenSpec `global/analytics`, design D5).
 */
const KEPT_QUERY_KEYS = new Set(['artists', 'journey', 'from'])

/** The parts of a PostHog `$exception` event this filter reads and rewrites. */
interface ErrorReportLike extends AnalyticsEventLike {
	event?: string
}

/**
 * `before_send` for every event. An `$exception` (error report) keeps
 * `artists`, `journey` and `from` on its `$current_url` and has its exception
 * values redacted; every other address, and every other event, goes through
 * {@link stripOwnUrlQuery} unchanged.
 *
 * Pure: the event is not mutated; a copy is returned.
 */
export function filterAnalyticsEvent<T extends ErrorReportLike>(
	event: T | null,
	origin: string,
): T | null {
	const stripped = stripOwnUrlQuery(event, origin)
	if (event === null || stripped === null || event.event !== '$exception') {
		return stripped
	}
	const properties = { ...stripped.properties }
	const currentUrl = event.properties?.$current_url
	if (typeof currentUrl === 'string') {
		properties.$current_url = keepFilterQuery(currentUrl, origin)
	}
	if (Array.isArray(properties.$exception_list)) {
		properties.$exception_list = properties.$exception_list.map(redactValue)
	}
	return { ...stripped, properties }
}

/**
 * The address with only the kept query keys, in their original order and
 * spelling, and no fragment. Addresses on other origins are returned as they
 * are.
 */
function keepFilterQuery(value: string, origin: string): string {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return value
	}
	if (url.origin !== origin) return value
	// Read the raw pairs rather than URLSearchParams.toString(), which would
	// re-encode `a1,a2` as `a1%2Ca2`.
	const kept = url.search
		.slice(1)
		.split('&')
		.filter((pair) => {
			const key = pair.split('=', 1)[0]
			try {
				return KEPT_QUERY_KEYS.has(decodeURIComponent(key))
			} catch {
				return false
			}
		})
	return `${url.origin}${url.pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}`
}

function redactValue(entry: unknown): unknown {
	if (entry === null || typeof entry !== 'object') return entry
	const value = (entry as { value?: unknown }).value
	if (typeof value !== 'string') return entry
	return { ...entry, value: redactSecrets(value) }
}
