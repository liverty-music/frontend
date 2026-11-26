import { ZONE_NAMES_EN, ZONE_NAMES_JA } from './zone-name-data'

/**
 * How a time zone is named on screen: the city name of the zone followed by
 * 時間 in Japanese or `time` in English (`ロンドン時間`, `London time`).
 *
 * The name of a Venue's or a sale's zone belongs to the API (the reference
 * data's `name_ja` / `name_en`, carried by `TimeZoneOption`). Screens that
 * hold those options register them here with `registerZoneNames`. Other
 * responses carry only the IANA name, so a zone nobody registered is named
 * from the copy of the reference data in `zone-name-data.ts`, and a zone it
 * does not list from the city part of its IANA name.
 */

export type DisplayLanguage = 'ja' | 'en'

export interface ZoneNames {
	readonly ja?: string
	readonly en: string
}

const registered = new Map<string, ZoneNames>()

/** Remember the names the API returned for zones (`TimeZoneOption`). */
export function registerZoneNames(
	options: ReadonlyArray<{ zone: string; nameJa?: string; nameEn: string }>,
): void {
	for (const o of options) {
		registered.set(o.zone, { ja: o.nameJa, en: o.nameEn })
	}
}

/** Forget every registered name (tests). */
export function clearRegisteredZoneNames(): void {
	registered.clear()
}

function cityOf(zone: string): string {
	return (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
}

/** The zone's city name in the display language (`日本` / `Japan` for Japan time). */
export function zoneName(zone: string, lang: DisplayLanguage): string {
	const api = registered.get(zone)
	// A name the API leaves empty is no name: the next source answers.
	const en = api?.en || ZONE_NAMES_EN[zone] || cityOf(zone)
	if (lang === 'ja') return api?.ja || ZONE_NAMES_JA[zone] || en
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
