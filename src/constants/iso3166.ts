/**
 * ISO 3166-2 subdivision codes for Japanese prefectures.
 * Maps ISO code to locale-specific display names and i18n translation keys.
 */

interface PrefectureEntry {
	ja: string
	en: string
	key: string
}

const JP_PREFECTURES: Record<string, PrefectureEntry> = {
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
 * e.g., "JP-13" → "tokyo", "JP-40" → "fukuoka"
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
 * @example codeToHome('JP-13') → { countryCode: 'JP', level1: 'JP-13' }
 */
export function codeToHome(code: string): {
	countryCode: string
	level1: string
} {
	const countryCode = code.slice(0, 2)
	return { countryCode, level1: code }
}

export interface PrefectureOption {
	code: string
	key: string
}

/**
 * All Japanese prefecture entries as { code, key } pairs for UI selectors.
 * Use i18n tr(`userHome.prefectures.${key}`) for display.
 */
export const JP_PREFECTURE_OPTIONS: PrefectureOption[] = Object.entries(
	JP_PREFECTURES,
).map(([code, entry]) => ({
	code,
	key: entry.key,
}))

export interface CityOption {
	key: string
	code: string
}

/**
 * Quick-select city mapping: i18n key + ISO 3166-2 code.
 */
export const QUICK_SELECT_CITIES: CityOption[] = [
	{ key: 'tokyo', code: 'JP-13' },
	{ key: 'osaka', code: 'JP-27' },
	{ key: 'nagoya', code: 'JP-23' },
	{ key: 'fukuoka', code: 'JP-40' },
	{ key: 'sapporo', code: 'JP-01' },
	{ key: 'sendai', code: 'JP-04' },
]

/**
 * Region groupings for the area selector sheet.
 */
export interface RegionGroup {
	key: string
	prefectures: PrefectureOption[]
}

export const REGION_GROUPS: RegionGroup[] = [
	{ key: 'hokkaido', prefectures: [{ code: 'JP-01', key: 'hokkaido' }] },
	{
		key: 'tohoku',
		prefectures: [
			{ code: 'JP-02', key: 'aomori' },
			{ code: 'JP-03', key: 'iwate' },
			{ code: 'JP-04', key: 'miyagi' },
			{ code: 'JP-05', key: 'akita' },
			{ code: 'JP-06', key: 'yamagata' },
			{ code: 'JP-07', key: 'fukushima' },
		],
	},
	{
		key: 'kanto',
		prefectures: [
			{ code: 'JP-08', key: 'ibaraki' },
			{ code: 'JP-09', key: 'tochigi' },
			{ code: 'JP-10', key: 'gunma' },
			{ code: 'JP-11', key: 'saitama' },
			{ code: 'JP-12', key: 'chiba' },
			{ code: 'JP-13', key: 'tokyo' },
			{ code: 'JP-14', key: 'kanagawa' },
		],
	},
	{
		key: 'chubu',
		prefectures: [
			{ code: 'JP-15', key: 'niigata' },
			{ code: 'JP-16', key: 'toyama' },
			{ code: 'JP-17', key: 'ishikawa' },
			{ code: 'JP-18', key: 'fukui' },
			{ code: 'JP-19', key: 'yamanashi' },
			{ code: 'JP-20', key: 'nagano' },
			{ code: 'JP-21', key: 'gifu' },
			{ code: 'JP-22', key: 'shizuoka' },
			{ code: 'JP-23', key: 'aichi' },
		],
	},
	{
		key: 'kinki',
		prefectures: [
			{ code: 'JP-24', key: 'mie' },
			{ code: 'JP-25', key: 'shiga' },
			{ code: 'JP-26', key: 'kyoto' },
			{ code: 'JP-27', key: 'osaka' },
			{ code: 'JP-28', key: 'hyogo' },
			{ code: 'JP-29', key: 'nara' },
			{ code: 'JP-30', key: 'wakayama' },
		],
	},
	{
		key: 'chugoku',
		prefectures: [
			{ code: 'JP-31', key: 'tottori' },
			{ code: 'JP-32', key: 'shimane' },
			{ code: 'JP-33', key: 'okayama' },
			{ code: 'JP-34', key: 'hiroshima' },
			{ code: 'JP-35', key: 'yamaguchi' },
		],
	},
	{
		key: 'shikoku',
		prefectures: [
			{ code: 'JP-36', key: 'tokushima' },
			{ code: 'JP-37', key: 'kagawa' },
			{ code: 'JP-38', key: 'ehime' },
			{ code: 'JP-39', key: 'kochi' },
		],
	},
	{
		key: 'kyushu',
		prefectures: [
			{ code: 'JP-40', key: 'fukuoka' },
			{ code: 'JP-41', key: 'saga' },
			{ code: 'JP-42', key: 'nagasaki' },
			{ code: 'JP-43', key: 'kumamoto' },
			{ code: 'JP-44', key: 'oita' },
			{ code: 'JP-45', key: 'miyazaki' },
			{ code: 'JP-46', key: 'kagoshima' },
			{ code: 'JP-47', key: 'okinawa' },
		],
	},
]
