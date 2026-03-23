import type { Hype } from '../../entities/follow'

/**
 * Display metadata for each hype tier.
 * Maps hype values to their UI label key and icon.
 */
export const HYPE_TIERS: Record<Hype, { labelKey: string; icon: string }> = {
	watch: { labelKey: 'myArtists.table.watch', icon: '👀' },
	home: { labelKey: 'myArtists.table.home', icon: '🔥' },
	nearby: { labelKey: 'myArtists.table.nearby', icon: '🔥🔥' },
	away: { labelKey: 'myArtists.table.away', icon: '🔥🔥🔥' },
}
