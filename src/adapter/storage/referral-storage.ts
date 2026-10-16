/**
 * Persistence adapter for the referral code of the last event link the fan
 * opened (OpenSpec `referral-attribution`, design D7).
 *
 * The Event page keeps the code with the Series it was opened for; the checkout
 * and the lottery entry screen read it back and send it with Start only for the
 * same Series. localStorage, not sessionStorage: the code must survive the OIDC
 * sign-up round trip, other tabs and closing the browser. Sign-out does not
 * clear it: it is not personal data of the account.
 */

const KEY = 'referral'

/** How long a kept code counts: 7 days from opening the link. */
export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** A ReferralCode: 1 to 32 lowercase ASCII letters, digits or hyphens. */
const REFERRAL_CODE_PATTERN = /^[a-z0-9-]{1,32}$/

/** The referral code kept on the device. */
export interface KeptReferral {
	readonly code: string
	readonly seriesId: string
	/** Epoch milliseconds after which the code no longer counts. */
	readonly expiresAt: number
}

/**
 * The ReferralCode a link's `ref` value stands for: the value lowercased, or
 * null when the lowercased value is not a valid ReferralCode. Lowercasing is
 * the fan app's job, so `Member-A` and `member-a` count as one code.
 */
export function normalizeReferralCode(
	raw: string | null | undefined,
): string | null {
	if (raw == null) return null
	const code = raw.toLowerCase()
	return REFERRAL_CODE_PATTERN.test(code) ? code : null
}

/**
 * Keep `code` for `seriesId` until 7 days after `now`, replacing any code kept
 * before (the last link wins).
 */
export function saveReferral(
	code: string,
	seriesId: string,
	now: number = Date.now(),
): void {
	const value: KeptReferral = {
		code,
		seriesId,
		expiresAt: now + REFERRAL_TTL_MS,
	}
	try {
		localStorage.setItem(KEY, JSON.stringify(value))
	} catch {
		// Private mode or blocked storage: the purchase still works, it just
		// counts as direct.
	}
}

/**
 * The kept code, or null when none is kept. An expired or malformed entry is
 * removed and reads as absent.
 */
export function loadReferral(now: number = Date.now()): KeptReferral | null {
	let raw: string | null
	try {
		raw = localStorage.getItem(KEY)
	} catch {
		return null
	}
	if (raw === null) return null

	const kept = parse(raw)
	if (kept === null || now >= kept.expiresAt) {
		removeReferral()
		return null
	}
	return kept
}

/**
 * The kept code when it was kept for `seriesId` and has not expired, else
 * undefined: what the checkout and the lottery entry send with Start.
 */
export function referralCodeForSeries(
	seriesId: string | undefined,
	now: number = Date.now(),
): string | undefined {
	if (!seriesId) return undefined
	const kept = loadReferral(now)
	return kept?.seriesId === seriesId ? kept.code : undefined
}

function parse(raw: string): KeptReferral | null {
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof value !== 'object' || value === null) return null
	const { code, seriesId, expiresAt } = value as Record<string, unknown>
	if (
		typeof code !== 'string' ||
		!REFERRAL_CODE_PATTERN.test(code) ||
		typeof seriesId !== 'string' ||
		seriesId === '' ||
		typeof expiresAt !== 'number' ||
		!Number.isFinite(expiresAt)
	) {
		return null
	}
	return { code, seriesId, expiresAt }
}

function removeReferral(): void {
	try {
		localStorage.removeItem(KEY)
	} catch {
		// Nothing to clean up when storage is unavailable.
	}
}
