/**
 * A user's home area setting.
 * @source proto/liverty_music/entity/v1/user.proto — Home
 */
export interface UserHome {
	readonly countryCode: string
	readonly level1: string
	readonly level2?: string
}

/**
 * A registered user in the system.
 * @source proto/liverty_music/entity/v1/user.proto — User
 */
export interface User {
	/** The internal UUID assigned by the backend. Used on per-user RPC requests. */
	readonly id: string
	readonly home?: UserHome
	/**
	 * The user's preferred display language as an ISO 639-1 two-letter code
	 * (e.g., "ja", "en"). Absent (`undefined`) when the backend row has not yet
	 * captured a language preference — in that case the hydration task backfills
	 * it from the currently effective i18n locale.
	 *
	 * @source proto/liverty_music/entity/v1/user.proto — User.preferred_language
	 */
	readonly preferredLanguage?: string
}

// ---------------------------------------------------------------------------
// ISO 3166-2 location domain logic
// ---------------------------------------------------------------------------

interface PrefectureEntry {
	ja: string
	en: string
	key: string
}

/** ISO 3166-2 subdivision data for Japanese prefectures. */
export const JP_PREFECTURES: Record<string, PrefectureEntry> = {
	'JP-01': { ja: '北海道', en: 'Hokkaido', key: 'hokkaido' },
	'JP-02': { ja: '青森県', en: 'Aomori', key: 'aomori' },
	'JP-03': { ja: '岩手県', en: 'Iwate', key: 'iwate' },
	'JP-04': { ja: '宮城県', en: 'Miyagi', key: 'miyagi' },
	'JP-05': { ja: '秋田県', en: 'Akita', key: 'akita' },
	'JP-06': { ja: '山形県', en: 'Yamagata', key: 'yamagata' },
	'JP-07': { ja: '福島県', en: 'Fukushima', key: 'fukushima' },
	'JP-08': { ja: '茨城県', en: 'Ibaraki', key: 'ibaraki' },
	'JP-09': { ja: '栃木県', en: 'Tochigi', key: 'tochigi' },
	'JP-10': { ja: '群馬県', en: 'Gunma', key: 'gunma' },
	'JP-11': { ja: '埼玉県', en: 'Saitama', key: 'saitama' },
	'JP-12': { ja: '千葉県', en: 'Chiba', key: 'chiba' },
	'JP-13': { ja: '東京都', en: 'Tokyo', key: 'tokyo' },
	'JP-14': { ja: '神奈川県', en: 'Kanagawa', key: 'kanagawa' },
	'JP-15': { ja: '新潟県', en: 'Niigata', key: 'niigata' },
	'JP-16': { ja: '富山県', en: 'Toyama', key: 'toyama' },
	'JP-17': { ja: '石川県', en: 'Ishikawa', key: 'ishikawa' },
	'JP-18': { ja: '福井県', en: 'Fukui', key: 'fukui' },
	'JP-19': { ja: '山梨県', en: 'Yamanashi', key: 'yamanashi' },
	'JP-20': { ja: '長野県', en: 'Nagano', key: 'nagano' },
	'JP-21': { ja: '岐阜県', en: 'Gifu', key: 'gifu' },
	'JP-22': { ja: '静岡県', en: 'Shizuoka', key: 'shizuoka' },
	'JP-23': { ja: '愛知県', en: 'Aichi', key: 'aichi' },
	'JP-24': { ja: '三重県', en: 'Mie', key: 'mie' },
	'JP-25': { ja: '滋賀県', en: 'Shiga', key: 'shiga' },
	'JP-26': { ja: '京都府', en: 'Kyoto', key: 'kyoto' },
	'JP-27': { ja: '大阪府', en: 'Osaka', key: 'osaka' },
	'JP-28': { ja: '兵庫県', en: 'Hyogo', key: 'hyogo' },
	'JP-29': { ja: '奈良県', en: 'Nara', key: 'nara' },
	'JP-30': { ja: '和歌山県', en: 'Wakayama', key: 'wakayama' },
	'JP-31': { ja: '鳥取県', en: 'Tottori', key: 'tottori' },
	'JP-32': { ja: '島根県', en: 'Shimane', key: 'shimane' },
	'JP-33': { ja: '岡山県', en: 'Okayama', key: 'okayama' },
	'JP-34': { ja: '広島県', en: 'Hiroshima', key: 'hiroshima' },
	'JP-35': { ja: '山口県', en: 'Yamaguchi', key: 'yamaguchi' },
	'JP-36': { ja: '徳島県', en: 'Tokushima', key: 'tokushima' },
	'JP-37': { ja: '香川県', en: 'Kagawa', key: 'kagawa' },
	'JP-38': { ja: '愛媛県', en: 'Ehime', key: 'ehime' },
	'JP-39': { ja: '高知県', en: 'Kochi', key: 'kochi' },
	'JP-40': { ja: '福岡県', en: 'Fukuoka', key: 'fukuoka' },
	'JP-41': { ja: '佐賀県', en: 'Saga', key: 'saga' },
	'JP-42': { ja: '長崎県', en: 'Nagasaki', key: 'nagasaki' },
	'JP-43': { ja: '熊本県', en: 'Kumamoto', key: 'kumamoto' },
	'JP-44': { ja: '大分県', en: 'Oita', key: 'oita' },
	'JP-45': { ja: '宮崎県', en: 'Miyazaki', key: 'miyazaki' },
	'JP-46': { ja: '鹿児島県', en: 'Kagoshima', key: 'kagoshima' },
	'JP-47': { ja: '沖縄県', en: 'Okinawa', key: 'okinawa' },
}

/**
 * Approximate WGS 84 centroid coordinates for each Japanese prefecture, keyed by
 * the same ISO 3166-2 code space as {@link JP_PREFECTURES} (single source of
 * truth — every key here MUST exist there). Used to resolve a `GeoLocation`
 * reference point on the client before calling `ConcertService.ListByLocation`,
 * so the server never needs ISO 3166-2 centroid-resolution logic for the
 * area-override path. Values are prefecture geographic centers (not capitals),
 * accurate enough for a 200 km proximity classification.
 */
export const JP_PREFECTURE_CENTROIDS: Record<
	string,
	{ lat: number; lng: number }
> = {
	'JP-01': { lat: 43.386, lng: 142.837 }, // Hokkaido
	'JP-02': { lat: 40.749, lng: 140.884 }, // Aomori
	'JP-03': { lat: 39.599, lng: 141.377 }, // Iwate
	'JP-04': { lat: 38.457, lng: 140.966 }, // Miyagi
	'JP-05': { lat: 39.752, lng: 140.407 }, // Akita
	'JP-06': { lat: 38.457, lng: 140.108 }, // Yamagata
	'JP-07': { lat: 37.437, lng: 140.315 }, // Fukushima
	'JP-08': { lat: 36.303, lng: 140.319 }, // Ibaraki
	'JP-09': { lat: 36.694, lng: 139.813 }, // Tochigi
	'JP-10': { lat: 36.541, lng: 138.947 }, // Gunma
	'JP-11': { lat: 35.997, lng: 139.442 }, // Saitama
	'JP-12': { lat: 35.394, lng: 140.243 }, // Chiba
	'JP-13': { lat: 35.686, lng: 139.556 }, // Tokyo
	'JP-14': { lat: 35.401, lng: 139.353 }, // Kanagawa
	'JP-15': { lat: 37.522, lng: 138.919 }, // Niigata
	'JP-16': { lat: 36.637, lng: 137.264 }, // Toyama
	'JP-17': { lat: 36.591, lng: 136.726 }, // Ishikawa
	'JP-18': { lat: 35.845, lng: 136.264 }, // Fukui
	'JP-19': { lat: 35.607, lng: 138.573 }, // Yamanashi
	'JP-20': { lat: 36.152, lng: 138.028 }, // Nagano
	'JP-21': { lat: 35.783, lng: 137.058 }, // Gifu
	'JP-22': { lat: 34.917, lng: 138.313 }, // Shizuoka
	'JP-23': { lat: 35.036, lng: 137.212 }, // Aichi
	'JP-24': { lat: 34.469, lng: 136.359 }, // Mie
	'JP-25': { lat: 35.222, lng: 136.135 }, // Shiga
	'JP-26': { lat: 35.253, lng: 135.529 }, // Kyoto
	'JP-27': { lat: 34.622, lng: 135.508 }, // Osaka
	'JP-28': { lat: 34.985, lng: 134.813 }, // Hyogo
	'JP-29': { lat: 34.339, lng: 135.877 }, // Nara
	'JP-30': { lat: 33.913, lng: 135.499 }, // Wakayama
	'JP-31': { lat: 35.393, lng: 133.804 }, // Tottori
	'JP-32': { lat: 35.037, lng: 132.708 }, // Shimane
	'JP-33': { lat: 34.897, lng: 133.792 }, // Okayama
	'JP-34': { lat: 34.593, lng: 132.774 }, // Hiroshima
	'JP-35': { lat: 34.219, lng: 131.573 }, // Yamaguchi
	'JP-36': { lat: 33.919, lng: 134.315 }, // Tokushima
	'JP-37': { lat: 34.256, lng: 133.964 }, // Kagawa
	'JP-38': { lat: 33.665, lng: 132.936 }, // Ehime
	'JP-39': { lat: 33.469, lng: 133.462 }, // Kochi
	'JP-40': { lat: 33.526, lng: 130.618 }, // Fukuoka
	'JP-41': { lat: 33.281, lng: 130.081 }, // Saga
	'JP-42': { lat: 33.147, lng: 129.612 }, // Nagasaki
	'JP-43': { lat: 32.649, lng: 130.783 }, // Kumamoto
	'JP-44': { lat: 33.208, lng: 131.427 }, // Oita
	'JP-45': { lat: 32.166, lng: 131.278 }, // Miyazaki
	'JP-46': { lat: 31.56, lng: 130.559 }, // Kagoshima
	'JP-47': { lat: 26.459, lng: 127.937 }, // Okinawa
}

/**
 * The init shape of a `liverty_music.entity.v1.GeoLocation` proto message. The
 * generated protobuf-es constructor accepts this object directly
 * (`new GeoLocation(geoLocationFromLevel1(code))`), mirroring how
 * {@link codeToHome} feeds `new Home(...)`. Keeping the entities layer free of
 * generated-proto imports is intentional — the RPC client owns the wrapping.
 */
export interface GeoLocationInit {
	latitude: number
	longitude: number
	adminArea: string
}

/**
 * Resolves an ISO 3166-2 prefecture code into a `GeoLocation` init object using
 * {@link JP_PREFECTURE_CENTROIDS}. Returns `undefined` when the code has no known
 * centroid (non-JP or unknown code), so callers can fall back to the user's home
 * coordinates.
 *
 * @example geoLocationFromLevel1('JP-13')
 *   -> { latitude: 35.686, longitude: 139.556, adminArea: 'JP-13' }
 */
export function geoLocationFromLevel1(
	level1: string,
): GeoLocationInit | undefined {
	const centroid = JP_PREFECTURE_CENTROIDS[level1]
	if (!centroid) return undefined
	return { latitude: centroid.lat, longitude: centroid.lng, adminArea: level1 }
}

/**
 * Returns the display name for an ISO 3166-2 code in the given locale.
 * Falls back to the code itself if not found.
 */
export function displayName(code: string, lang: 'ja' | 'en' = 'ja'): string {
	const entry = JP_PREFECTURES[code]
	if (!entry) return code
	return entry[lang]
}

/**
 * Returns the i18n translation key for an ISO 3166-2 code.
 * e.g., "JP-13" -> "tokyo", "JP-40" -> "fukuoka"
 */
export function translationKey(code: string): string {
	const entry = JP_PREFECTURES[code]
	if (!entry) return code
	return entry.key
}

/**
 * Converts an ISO 3166-2 code to a structured Home object
 * suitable for the backend CreateRequest / UpdateHomeRequest.
 *
 * Phase 1 (Japan-only): level_2 is always omitted.
 *
 * @example codeToHome('JP-13') -> { countryCode: 'JP', level1: 'JP-13' }
 */
export function codeToHome(code: string): {
	countryCode: string
	level1: string
} {
	const countryCode = code.slice(0, 2)
	return { countryCode, level1: code }
}
