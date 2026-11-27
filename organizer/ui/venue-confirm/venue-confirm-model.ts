import { zoneName } from '../../../shared/lib/zoned-time/zone-name'
import type { ConsoleLocale } from '../../i18n/format'
import type { Area, Country, CountryAreas } from '../../services/venue-client'

/**
 * What the member confirmed for an event's picked place: the Venue that holds
 * it (read-only), or the name, area and time zone of the new Venue to create.
 */
export interface VenueConfirmation {
	/** The picked place this confirmation belongs to. */
	readonly placeId: string
	readonly kind: 'venue' | 'draft'
	readonly name: string
	/** The country the area is chosen from; '' only before it is known. */
	readonly countryCode: string
	/** The first-level Area code; '' when none is chosen. */
	readonly adminArea: string
	/** The IANA time zone; '' when none is chosen. */
	readonly timeZone: string
}

/** One choice of a select: its value and the text shown. */
export interface Choice {
	readonly value: string
	readonly label: string
}

/** The Areas under one region; `label` is '' for a country without regions. */
export interface AreaGroup {
	readonly label: string
	readonly areas: Choice[]
}

/** A name in the member's language: the Japanese one when shown in Japanese and known. */
export function localName(
	locale: ConsoleLocale,
	en: string,
	ja: string | undefined,
): string {
	return locale === 'ja' && ja ? ja : en
}

export function areaLabel(area: Area, locale: ConsoleLocale): string {
	return localName(locale, area.nameEn, area.nameJa)
}

export function countryChoices(
	countries: Country[],
	locale: ConsoleLocale,
): Choice[] {
	return countries.map((c) => ({
		value: c.code?.value ?? '',
		label: localName(locale, c.nameEn, c.nameJa),
	}))
}

/**
 * The country's first-level Areas grouped under its regions, in the server's
 * order; an Area in no region, or every Area of a country without regions,
 * goes to a group with no label.
 */
export function areaGroups(
	country: CountryAreas,
	locale: ConsoleLocale,
): AreaGroup[] {
	const groups = new Map<string, Choice[]>()
	const labels = new Map<string, string>()
	for (const region of country.regions) {
		const code = region.code?.value ?? ''
		groups.set(code, [])
		labels.set(code, areaLabel(region, locale))
	}
	const loose: Choice[] = []
	for (const area of country.areas) {
		const choice = {
			value: area.code?.value ?? '',
			label: areaLabel(area, locale),
		}
		const region = area.regionCodes
			.map((c) => c.value)
			.find((c) => groups.has(c))
		if (region) groups.get(region)?.push(choice)
		else loose.push(choice)
	}
	const out: AreaGroup[] = []
	for (const [code, areas] of groups) {
		if (areas.length > 0) out.push({ label: labels.get(code) ?? '', areas })
	}
	if (loose.length > 0) out.push({ label: '', areas: loose })
	return out
}

/**
 * The zone's current offset from UTC, as `UTC+9`, `UTC−8` (a minus sign) or
 * `UTC+5:30`, at `at`.
 */
export function utcOffset(zone: string, at: Date): string {
	const part = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		timeZoneName: 'shortOffset',
	})
		.formatToParts(at)
		.find((p) => p.type === 'timeZoneName')?.value
	const offset = part?.replace(/^GMT/, '') || '+0'
	return `UTC${offset.replace('-', '−')}`
}

/** The country's time zones as `ロサンゼルス (UTC−8)`, at `at`. */
export function zoneChoices(
	country: CountryAreas,
	locale: ConsoleLocale,
	at: Date,
): Choice[] {
	return country.timeZones.map((z) => {
		const value = z.timeZone?.value ?? ''
		return {
			value,
			label: `${zoneName(value, locale)} (${utcOffset(value, at)})`,
		}
	})
}

/** The zone of a whole Area, or '' when the Area spans zones or is unknown. */
export function areaZone(country: CountryAreas, areaCode: string): string {
	return (
		country.areas.find((a) => a.code?.value === areaCode)?.timeZone?.value ?? ''
	)
}

/** The name of an Area of the country, or the code when the country has no such Area. */
export function areaNameOf(
	country: CountryAreas | null,
	areaCode: string,
	locale: ConsoleLocale,
): string {
	const area = country?.areas.find((a) => a.code?.value === areaCode)
	return area ? areaLabel(area, locale) : areaCode
}
