/**
 * Re-exports domain logic from entities/user.ts for backward compatibility.
 * UI-specific reference data (prefecture options, region groups) remains here.
 */
export {
	codeToHome,
	displayName,
	JP_PREFECTURES,
	translationKey,
} from '../entities/user'

export interface PrefectureOption {
	code: string
	key: string
}

/**
 * All Japanese prefecture entries as { code, key } pairs for UI selectors.
 * Use i18n tr(`userHome.prefectures.${key}`) for display.
 */
import { JP_PREFECTURES } from '../entities/user'

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
