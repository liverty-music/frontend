/**
 * The query parameter that carries the concert whose sheet is open
 * (`/timetable?concert=:id`). The sheet adds it on open and removes it on
 * close; the timetable opens the sheet when it loads with one.
 */
export const CONCERT_QUERY_PARAM = 'concert'

/**
 * A query string (`?a=1&concert=x`) without the `concert` parameter, keeping
 * every other parameter as it was written (`artists=a,b` stays unencoded).
 * Returns `''` when nothing is left.
 */
export function withoutConcertParam(search: string): string {
	const kept = search
		.replace(/^\?/, '')
		.split('&')
		.filter(
			(part) => part !== '' && !part.startsWith(`${CONCERT_QUERY_PARAM}=`),
		)
	return kept.length > 0 ? `?${kept.join('&')}` : ''
}
