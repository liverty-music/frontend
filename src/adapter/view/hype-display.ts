import type { Hype } from '../../entities/follow'

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
