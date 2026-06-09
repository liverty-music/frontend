/**
 * Coach-mark trigger thresholds for the discovery → dashboard hint.
 * Consumed directly by `DiscoveryRoute` to decide when to surface the coach
 * mark from live follow/concert counts.
 */

/** Minimum followed artists that trigger the dashboard coach mark. */
export const DASHBOARD_FOLLOW_TARGET = 5
/** Minimum artists with concerts that trigger the dashboard coach mark. */
export const DASHBOARD_CONCERT_TARGET = 3
