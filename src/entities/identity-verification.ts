/**
 * The fan's 本人確認 (identity check) domain model (identity-ekyc-jpki).
 *
 * This is the platform's own, generated-proto-free view of an
 * `IdentityVerification`: the result of a 本人確認 that binds one account to a
 * verified real person, established via マイナンバーカード 公的個人認証 (JPKI) —
 * or the 運転免許証 IC fallback — through the verification provider (PocketSign
 * Verify). The frontend only ever reads the *result* of a verification (method
 * + dedupe strength + status + freshness); it never handles the raw
 * certificate, the 個人番号, or the certificate serial.
 *
 * Keeping these as plain string-literal unions (rather than re-exporting the
 * generated numeric enums) mirrors the `JourneyStatus` pattern in
 * `entities/concert.ts`: the domain layer stays free of generated-proto imports
 * and the wire mapping lives in the RPC mapper.
 *
 * Bare "identity" is reserved for the sign-in account at the identity
 * provider; the 本人確認 result is always an IdentityVerification (design D16
 * of unify-ticket-sales).
 *
 * @source proto/liverty_music/entity/v1/identity_verification.proto — IdentityVerification
 */

/**
 * How a person proved who they are. Drives the dedupe guarantee and whether a
 * JPKI-only sale admits the verification.
 * - `jpki` — マイナンバーカード 公的個人認証 (high assurance, STRONG dedupe).
 * - `driverLicence` — 運転免許証 IC fallback (WEAK dedupe).
 */
export type VerificationMethod = 'jpki' | 'driverLicence'

/**
 * Strength of the "one person = one account" guarantee a verification carries.
 * Follows from the method: JPKI yields a stable per-person key (`strong`); the
 * licence fallback yields only a document-scoped id that can change (`weak`).
 */
export type DedupeStrength = 'strong' | 'weak'

/**
 * Freshness lifecycle of an IdentityVerification, maintained by the periodic
 * 現況確認 (liveness) re-check. A revoked/changed result flags it for
 * re-verification rather than hard-locking the account.
 */
export type VerificationStatus = 'active' | 'needsReverification'

/**
 * The result of a fan's 本人確認 — only what the client renders. It carries NO
 * raw certificate, NO 個人番号, and NO serial; the `providerUserId` is the
 * verification provider's ID for the User, which the backend dedupes on.
 */
export interface IdentityVerification {
	/** Server-generated id of the IdentityVerification (a UUID). */
	readonly id: string
	/** The User this IdentityVerification is bound to. */
	readonly userId: string
	readonly method: VerificationMethod
	/** The verification provider's ID for the User. */
	readonly providerUserId: string
	readonly dedupeStrength: DedupeStrength
	readonly status: VerificationStatus
	/** When the verification was established (epoch millis), when known. */
	readonly verifyTime?: number
}

/**
 * Whether the fan counts as verified: only an Active IdentityVerification
 * verifies an account. None (the fan never verified) or one that needs
 * re-verification does not (design D11 of unify-ticket-sales).
 */
export function isVerified(
	identityVerification: IdentityVerification | undefined,
): boolean {
	return identityVerification?.status === 'active'
}

/** i18n key for a verification method's human label. */
export function verificationMethodLabelKey(method: VerificationMethod): string {
	return method === 'jpki'
		? 'settings.identityVerification.methodJpki'
		: 'settings.identityVerification.methodDriverLicence'
}

/** i18n key for a dedupe-strength human label. */
export function dedupeStrengthLabelKey(strength: DedupeStrength): string {
	return strength === 'strong'
		? 'settings.identityVerification.dedupeStrong'
		: 'settings.identityVerification.dedupeWeak'
}
