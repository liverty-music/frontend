import { ZONE_NAMES_EN, ZONE_NAMES_JA } from 'virtual:zone-names'

/**
 * How a time zone is named on screen: the city name of the zone followed by
 * 時間 in Japanese or `time` in English (`ロンドン時間`, `London time`).
 *
 * The app names every zone, a Venue's, a sale's or the browser's own, from its
 * IANA name alone: with the CLDR city name generated at build time
 * (`virtual:zone-names`), and a zone CLDR does not name from the city part of
 * its IANA name. In Japanese, a zone without a Japanese name takes the
 * English one.
 */

export type DisplayLanguage = 'ja' | 'en'

function cityOf(zone: string): string {
	return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** The zone's city name in the display language (`日本` / `Japan` for Japan time). */
export function zoneName(zone: string, lang: DisplayLanguage): string {
	const en = ZONE_NAMES_EN[zone] ?? cityOf(zone)
	if (lang === 'ja') return ZONE_NAMES_JA[zone] ?? en
	return en
}

/** The zone's name followed by 時間 or `time`: `ロンドン時間`, `London time`. */
export function zoneLabel(zone: string, lang: DisplayLanguage): string {
	const name = zoneName(zone, lang)
	return lang === 'ja' ? `${name}時間` : `${name} time`
}

/** The display language of an app's language code. */
export function displayLanguage(code: string): DisplayLanguage {
	return code.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
