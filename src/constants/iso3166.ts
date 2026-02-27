/**
 * ISO 3166-2 subdivision codes for Japanese prefectures.
 * Maps ISO code to locale-specific display names.
 */

interface PrefectureEntry {
	ja: string
	en: string
}

const JP_PREFECTURES: Record<string, PrefectureEntry> = {
	'JP-01': { ja: '北海道', en: 'Hokkaido' },
	'JP-02': { ja: '青森県', en: 'Aomori' },
	'JP-03': { ja: '岩手県', en: 'Iwate' },
	'JP-04': { ja: '宮城県', en: 'Miyagi' },
	'JP-05': { ja: '秋田県', en: 'Akita' },
	'JP-06': { ja: '山形県', en: 'Yamagata' },
	'JP-07': { ja: '福島県', en: 'Fukushima' },
	'JP-08': { ja: '茨城県', en: 'Ibaraki' },
	'JP-09': { ja: '栃木県', en: 'Tochigi' },
	'JP-10': { ja: '群馬県', en: 'Gunma' },
	'JP-11': { ja: '埼玉県', en: 'Saitama' },
	'JP-12': { ja: '千葉県', en: 'Chiba' },
	'JP-13': { ja: '東京都', en: 'Tokyo' },
	'JP-14': { ja: '神奈川県', en: 'Kanagawa' },
	'JP-15': { ja: '新潟県', en: 'Niigata' },
	'JP-16': { ja: '富山県', en: 'Toyama' },
	'JP-17': { ja: '石川県', en: 'Ishikawa' },
	'JP-18': { ja: '福井県', en: 'Fukui' },
	'JP-19': { ja: '山梨県', en: 'Yamanashi' },
	'JP-20': { ja: '長野県', en: 'Nagano' },
	'JP-21': { ja: '岐阜県', en: 'Gifu' },
	'JP-22': { ja: '静岡県', en: 'Shizuoka' },
	'JP-23': { ja: '愛知県', en: 'Aichi' },
	'JP-24': { ja: '三重県', en: 'Mie' },
	'JP-25': { ja: '滋賀県', en: 'Shiga' },
	'JP-26': { ja: '京都府', en: 'Kyoto' },
	'JP-27': { ja: '大阪府', en: 'Osaka' },
	'JP-28': { ja: '兵庫県', en: 'Hyogo' },
	'JP-29': { ja: '奈良県', en: 'Nara' },
	'JP-30': { ja: '和歌山県', en: 'Wakayama' },
	'JP-31': { ja: '鳥取県', en: 'Tottori' },
	'JP-32': { ja: '島根県', en: 'Shimane' },
	'JP-33': { ja: '岡山県', en: 'Okayama' },
	'JP-34': { ja: '広島県', en: 'Hiroshima' },
	'JP-35': { ja: '山口県', en: 'Yamaguchi' },
	'JP-36': { ja: '徳島県', en: 'Tokushima' },
	'JP-37': { ja: '香川県', en: 'Kagawa' },
	'JP-38': { ja: '愛媛県', en: 'Ehime' },
	'JP-39': { ja: '高知県', en: 'Kochi' },
	'JP-40': { ja: '福岡県', en: 'Fukuoka' },
	'JP-41': { ja: '佐賀県', en: 'Saga' },
	'JP-42': { ja: '長崎県', en: 'Nagasaki' },
	'JP-43': { ja: '熊本県', en: 'Kumamoto' },
	'JP-44': { ja: '大分県', en: 'Oita' },
	'JP-45': { ja: '宮崎県', en: 'Miyazaki' },
	'JP-46': { ja: '鹿児島県', en: 'Kagoshima' },
	'JP-47': { ja: '沖縄県', en: 'Okinawa' },
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
 * Returns the short display name (without suffix) for Japanese prefectures.
 * e.g., "JP-13" → "東京", "JP-27" → "大阪"
 */
export function shortDisplayName(code: string): string {
	const entry = JP_PREFECTURES[code]
	if (!entry) return code
	return entry.ja.replace(/[都道府県]$/, '')
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

/**
 * All Japanese prefecture entries as { code, label } pairs for UI selectors.
 * Label uses short Japanese name (without suffix).
 */
export const JP_PREFECTURE_OPTIONS = Object.entries(JP_PREFECTURES).map(
	([code, entry]) => ({
		code,
		label: entry.ja.replace(/[都道府県]$/, ''),
	}),
)

/**
 * Quick-select city mapping: city name → ISO 3166-2 code.
 */
export const QUICK_SELECT_CITIES: { label: string; code: string }[] = [
	{ label: '東京', code: 'JP-13' },
	{ label: '大阪', code: 'JP-27' },
	{ label: '名古屋', code: 'JP-23' },
	{ label: '福岡', code: 'JP-40' },
	{ label: '札幌', code: 'JP-01' },
	{ label: '仙台', code: 'JP-04' },
]

/**
 * Region groupings for the area selector sheet.
 */
export interface RegionGroup {
	name: string
	prefectures: { code: string; label: string }[]
}

export const REGION_GROUPS: RegionGroup[] = [
	{ name: '北海道', prefectures: [{ code: 'JP-01', label: '北海道' }] },
	{
		name: '東北',
		prefectures: [
			{ code: 'JP-02', label: '青森' },
			{ code: 'JP-03', label: '岩手' },
			{ code: 'JP-04', label: '宮城' },
			{ code: 'JP-05', label: '秋田' },
			{ code: 'JP-06', label: '山形' },
			{ code: 'JP-07', label: '福島' },
		],
	},
	{
		name: '関東',
		prefectures: [
			{ code: 'JP-08', label: '茨城' },
			{ code: 'JP-09', label: '栃木' },
			{ code: 'JP-10', label: '群馬' },
			{ code: 'JP-11', label: '埼玉' },
			{ code: 'JP-12', label: '千葉' },
			{ code: 'JP-13', label: '東京' },
			{ code: 'JP-14', label: '神奈川' },
		],
	},
	{
		name: '中部',
		prefectures: [
			{ code: 'JP-15', label: '新潟' },
			{ code: 'JP-16', label: '富山' },
			{ code: 'JP-17', label: '石川' },
			{ code: 'JP-18', label: '福井' },
			{ code: 'JP-19', label: '山梨' },
			{ code: 'JP-20', label: '長野' },
			{ code: 'JP-21', label: '岐阜' },
			{ code: 'JP-22', label: '静岡' },
			{ code: 'JP-23', label: '愛知' },
		],
	},
	{
		name: '近畿',
		prefectures: [
			{ code: 'JP-24', label: '三重' },
			{ code: 'JP-25', label: '滋賀' },
			{ code: 'JP-26', label: '京都' },
			{ code: 'JP-27', label: '大阪' },
			{ code: 'JP-28', label: '兵庫' },
			{ code: 'JP-29', label: '奈良' },
			{ code: 'JP-30', label: '和歌山' },
		],
	},
	{
		name: '中国',
		prefectures: [
			{ code: 'JP-31', label: '鳥取' },
			{ code: 'JP-32', label: '島根' },
			{ code: 'JP-33', label: '岡山' },
			{ code: 'JP-34', label: '広島' },
			{ code: 'JP-35', label: '山口' },
		],
	},
	{
		name: '四国',
		prefectures: [
			{ code: 'JP-36', label: '徳島' },
			{ code: 'JP-37', label: '香川' },
			{ code: 'JP-38', label: '愛媛' },
			{ code: 'JP-39', label: '高知' },
		],
	},
	{
		name: '九州',
		prefectures: [
			{ code: 'JP-40', label: '福岡' },
			{ code: 'JP-41', label: '佐賀' },
			{ code: 'JP-42', label: '長崎' },
			{ code: 'JP-43', label: '熊本' },
			{ code: 'JP-44', label: '大分' },
			{ code: 'JP-45', label: '宮崎' },
			{ code: 'JP-46', label: '鹿児島' },
			{ code: 'JP-47', label: '沖縄' },
		],
	},
]
