import type { Hype } from '../../entities/follow'
import { JP_PREFECTURES } from '../../entities/user'

/**
 * Display metadata for each hype tier.
 * Maps hype values to their invariant brand label and emoji icon. Labels are
 * Layer B brand expressions (per the brand-vocabulary spec) rendered in the
 * same English form across every locale; they are not sourced from i18n.
 */
export const HYPE_TIERS: Record<Hype, { label: string; icon: string }> = {
	watch: { label: 'Watch', icon: '👀' },
	home: { label: 'Home', icon: '🔥' },
	nearby: { label: 'Nearby', icon: '🔥🔥' },
	away: { label: 'Away', icon: '🔥🔥🔥' },
}

/** Translates a catalog key, as `I18N.tr` does. */
type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * The place words that say which new concerts of an artist reach the fan by
 * push at `hype`: 「全て」 for Away, the short name of the home prefecture
 * (「東京」) for Home, and that name with 「周辺」 (「東京周辺」) for Nearby.
 * Without a home, 「居住エリア」 takes the prefecture's place. Watch pushes
 * nothing, so it has no place words (`null`).
 *
 * `home` is the ISO 3166-2 code of the home prefecture (`User.home.level_1`,
 * or the guest's home on this device). The hype snack on My Artists, the
 * hype-raise snack and the out-of-range notice on the event detail sheet all
 * build their text from these words, so the three always say the same thing.
 */
export function hypeReachWords(
	hype: Hype,
	home: string | undefined,
	tr: Translate,
): string | null {
	if (hype === 'watch') return null
	if (hype === 'away') return tr('hypeReach.all')
	const entry = home ? JP_PREFECTURES[home] : undefined
	const place = entry
		? tr(`userHome.prefectures.${entry.key}`)
		: tr('hypeReach.noHome')
	return tr(`hypeReach.${hype}`, { place })
}
