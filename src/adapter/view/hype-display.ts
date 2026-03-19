import type { Hype } from '../../entities/follow'

/**
 * Display metadata for each hype tier.
 * Maps hype values to their UI label key and icon.
 */
export const HYPE_TIERS: Record<Hype, { labelKey: string; icon: string }> = {
	watch: { labelKey: 'チェック', icon: '👀' },
	home: { labelKey: '地元', icon: '🔥' },
	nearby: { labelKey: '近くも', icon: '🔥🔥' },
	away: { labelKey: 'どこでも！', icon: '🔥🔥🔥' },
}
