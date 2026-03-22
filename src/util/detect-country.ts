// Maps IANA timezone identifiers to ISO 3166-1 country names
// as accepted by the Last.fm API.
const TIMEZONE_TO_COUNTRY: Record<string, string> = {
	// East Asia
	'Asia/Tokyo': 'Japan',
	'Asia/Seoul': 'South Korea',
	'Asia/Shanghai': 'China',
	'Asia/Hong_Kong': 'China',
	'Asia/Taipei': 'Taiwan',

	// Southeast Asia
	'Asia/Singapore': 'Singapore',
	'Asia/Bangkok': 'Thailand',
	'Asia/Jakarta': 'Indonesia',
	'Asia/Manila': 'Philippines',
	'Asia/Ho_Chi_Minh': 'Vietnam',
	'Asia/Kuala_Lumpur': 'Malaysia',

	// South Asia
	'Asia/Kolkata': 'India',
	'Asia/Calcutta': 'India',

	// North America
	'America/New_York': 'United States',
	'America/Chicago': 'United States',
	'America/Denver': 'United States',
	'America/Los_Angeles': 'United States',
	'America/Phoenix': 'United States',
	'America/Anchorage': 'United States',
	'Pacific/Honolulu': 'United States',
	'America/Toronto': 'Canada',
	'America/Vancouver': 'Canada',
	'America/Edmonton': 'Canada',
	'America/Winnipeg': 'Canada',
	'America/Halifax': 'Canada',
	'America/Mexico_City': 'Mexico',

	// South America
	'America/Sao_Paulo': 'Brazil',
	'America/Argentina/Buenos_Aires': 'Argentina',
	'America/Santiago': 'Chile',
	'America/Bogota': 'Colombia',
	'America/Lima': 'Peru',

	// Europe
	'Europe/London': 'United Kingdom',
	'Europe/Berlin': 'Germany',
	'Europe/Paris': 'France',
	'Europe/Rome': 'Italy',
	'Europe/Madrid': 'Spain',
	'Europe/Amsterdam': 'Netherlands',
	'Europe/Brussels': 'Belgium',
	'Europe/Zurich': 'Switzerland',
	'Europe/Vienna': 'Austria',
	'Europe/Stockholm': 'Sweden',
	'Europe/Oslo': 'Norway',
	'Europe/Copenhagen': 'Denmark',
	'Europe/Helsinki': 'Finland',
	'Europe/Warsaw': 'Poland',
	'Europe/Prague': 'Czech Republic',
	'Europe/Budapest': 'Hungary',
	'Europe/Lisbon': 'Portugal',
	'Europe/Dublin': 'Ireland',
	'Europe/Athens': 'Greece',
	'Europe/Bucharest': 'Romania',
	'Europe/Istanbul': 'Turkey',
	'Europe/Moscow': 'Russia',
	'Europe/Kiev': 'Ukraine',
	'Europe/Kyiv': 'Ukraine',

	// Oceania
	'Australia/Sydney': 'Australia',
	'Australia/Melbourne': 'Australia',
	'Australia/Brisbane': 'Australia',
	'Australia/Perth': 'Australia',
	'Australia/Adelaide': 'Australia',
	'Pacific/Auckland': 'New Zealand',

	// Middle East
	'Asia/Dubai': 'United Arab Emirates',
	'Asia/Jerusalem': 'Israel',
	'Asia/Tel_Aviv': 'Israel',

	// Africa
	'Africa/Johannesburg': 'South Africa',
	'Africa/Cairo': 'Egypt',
	'Africa/Lagos': 'Nigeria',
}

function resolve(): string {
	try {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
		return TIMEZONE_TO_COUNTRY[tz] ?? ''
	} catch {
		return ''
	}
}

// Computed once at module load — timezone does not change during a session.
const detectedCountry = resolve()

/**
 * Returns the user's country inferred from the browser's IANA timezone.
 * The result is an ISO 3166-1 country name (e.g., "Japan") or an empty
 * string when the timezone cannot be mapped.
 *
 * The value is resolved once at module load and cached for the session.
 * No user permission is required.
 */
export function detectCountryFromTimezone(): string {
	return detectedCountry
}
