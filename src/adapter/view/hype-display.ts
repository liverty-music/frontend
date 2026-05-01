import type { Hype } from '../../entities/follow'

/**
 * Display metadata for each hype tier.
 * Maps hype values to their UI label key and icon. Labels live in the
 * canonical `entity.hype.values.*` i18n namespace per the brand-vocabulary
 * capability mirror rule.
 */
export const HYPE_TIERS: Record<Hype, { labelKey: string; icon: string }> = {
	watch: { labelKey: 'entity.hype.values.watch', icon: '👀' },
	home: { labelKey: 'entity.hype.values.home', icon: '🔥' },
	nearby: { labelKey: 'entity.hype.values.nearby', icon: '🔥🔥' },
	away: { labelKey: 'entity.hype.values.away', icon: '🔥🔥🔥' },
}
