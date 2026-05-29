/**
 * Shared easing primitives for the dna-orb canvas subsystem. Centralized here
 * so the "back" overshoot constant and curve set live in one place rather than
 * being re-declared across bubble-physics, absorption-animator, and tap-effects.
 */

/** Overshoot magnitude for the "back" easing family. */
const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1

export function easeInCubic(t: number): number {
	return t * t * t
}

export function easeOutQuad(t: number): number {
	return 1 - (1 - t) * (1 - t)
}

/** Ease-out with overshoot: shoots past 1 then settles back. */
export function easeOutBack(t: number): number {
	return 1 + BACK_C3 * (t - 1) ** 3 + BACK_C1 * (t - 1) ** 2
}

/** Ease-in with anticipation: dips back slightly before yanking toward 1. */
export function easeInBack(t: number): number {
	return BACK_C3 * t * t * t - BACK_C1 * t * t
}
