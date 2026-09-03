import { DI, ILogger, resolve } from 'aurelia'

export const IHapticService = DI.createInterface<IHapticService>(
	'IHapticService',
	(x) => x.singleton(HapticService),
)

export interface IHapticService extends HapticService {}

/** Pulse durations (ms) per feedback class. */
const TAP_MS = 10
const CONFIRM_MS = 20

/**
 * Shared haptic feedback, generalized from the discovery orb's private
 * `vibrate()` so any surface can pulse on a meaningful interaction through one
 * feature-detected seam.
 *
 * The Web Vibration API is absent on iOS Safari; `supported` is resolved once
 * at construction and every method no-ops (silently) where unsupported, so
 * callers never guard `navigator.vibrate` themselves. Haptics are always an
 * accompaniment to visual feedback, never the sole acknowledgement of an action.
 */
export class HapticService {
	private readonly logger = resolve(ILogger).scopeTo('HapticService')
	private readonly supported =
		typeof navigator !== 'undefined' && 'vibrate' in navigator

	/** Light pulse for a discrete tap (e.g. selecting a bubble). */
	public tap(): void {
		this.pulse(TAP_MS)
	}

	/** Slightly stronger pulse confirming a committed action (follow, submit). */
	public confirm(): void {
		this.pulse(CONFIRM_MS)
	}

	/** Fire an arbitrary pulse pattern where supported; no-op otherwise. */
	public pulse(pattern: number | number[]): void {
		if (!this.supported) return
		try {
			navigator.vibrate(pattern)
		} catch (err) {
			// Vibration may be blocked by the platform (permission, user setting);
			// swallow so it never breaks the surrounding interaction.
			this.logger.debug('vibrate blocked', { error: err })
		}
	}
}
