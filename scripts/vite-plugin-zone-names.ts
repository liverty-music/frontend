import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/**
 * `virtual:zone-names`: the time zone city names of the pinned CLDR release,
 * generated from the `cldr-dates-full` package whenever Vite builds or serves
 * the code that imports it, so only the names reach the bundle.
 *
 * The names are the ones the backend's `scripts/areas` writes to its
 * `time_zones` table from the same CLDR release (OpenSpec `globalize-venues`,
 * design Decision 14): a locale's own exemplar cities, and Japan for
 * Asia/Tokyo. `cldr-dates-full` must therefore stay at the CLDR release the
 * backend pins.
 */

const MODULE_ID = 'virtual:zone-names'
const RESOLVED_ID = `\0${MODULE_ID}`

/** The names that replace CLDR's exemplar city, as in the backend. */
const OVERRIDES = {
	en: { 'Asia/Tokyo': 'Japan' },
	ja: { 'Asia/Tokyo': '日本' },
}

const require = createRequire(import.meta.url)

/** One level of CLDR's zone tree: `Asia` → `Tokyo` → `exemplarCity`. */
interface ZoneNode {
	readonly [key: string]: ZoneNode | string
}

/** Exemplar city per IANA zone name, as a locale's JSON file lists them. */
function exemplarCities(locale: string): Map<string, string> {
	const file = require.resolve(
		`cldr-dates-full/main/${locale}/timeZoneNames.json`,
	)
	const data = JSON.parse(readFileSync(file, 'utf8'))
	const cities = new Map<string, string>()
	const walk = (node: ZoneNode, path: string[]): void => {
		for (const [key, value] of Object.entries(node)) {
			if (key === 'exemplarCity') cities.set(path.join('/'), value as string)
			else if (typeof value === 'object') walk(value, [...path, key])
		}
	}
	walk(data.main[locale].dates.timeZoneNames.zone, [])
	return cities
}

/**
 * The names a locale gives itself. The package's JSON also carries what a
 * locale inherits from CLDR's root locale (`und`), such as `São Paulo` in
 * English; the backend reads the locale's own file, so those are left out and
 * the zone is named from its IANA name (`Sao Paulo`).
 */
function ownNames(locale: 'en' | 'ja'): Record<string, string> {
	const root = exemplarCities('und')
	const own = [...exemplarCities(locale)].filter(
		([zone, city]) => root.get(zone) !== city,
	)
	return { ...Object.fromEntries(own), ...OVERRIDES[locale] }
}

export function zoneNames(): Plugin {
	return {
		name: 'zone-names',
		resolveId: (id) => (id === MODULE_ID ? RESOLVED_ID : undefined),
		load(id) {
			if (id !== RESOLVED_ID) return undefined
			return [
				`export const ZONE_NAMES_EN = ${JSON.stringify(ownNames('en'))}`,
				`export const ZONE_NAMES_JA = ${JSON.stringify(ownNames('ja'))}`,
			].join('\n')
		},
	}
}
