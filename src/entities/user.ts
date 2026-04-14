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
