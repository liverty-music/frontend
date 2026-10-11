/**
 * The fan's 本人確認 (KYC) domain model (identity-ekyc-jpki).
 *
 * This is the platform's own, generated-proto-free view of a `Kyc` and the
 * account verification level it backs. A Kyc binds one account to a verified
 * real person established via マイナンバーカード 公的個人認証 (JPKI) — or the
 * 運転免許証 IC fallback — through Pocket Sign (PocketSign Verify). The frontend
 * only ever reads the *result* of a verification (level + method + dedupe
 * strength + freshness); it never handles the raw certificate, the 個人番号, or
 * the certificate serial.
 *
 * Keeping these as plain string-literal unions (rather than re-exporting the
 * generated numeric enums) mirrors the `JourneyStatus` pattern in
 * `entities/concert.ts`: the domain layer stays free of generated-proto imports
 * and the wire mapping lives in the RPC mapper.
 *
 * "Identity" is reserved for the sign-in account at the identity provider; the
 * 本人確認 result is always a Kyc (design D16 of unify-ticket-sales).
 *
 * @source proto/liverty_music/entity/v1/kyc.proto — Kyc
 * @source proto/liverty_music/entity/v1/user.proto — VerificationLevel
 */

/**
 * Account-level 本人確認 assurance used by lottery entry and checkout.
 * Verification is a *lane*, not a universal mandate, so most accounts sit at
 * `unverified`.
 */
export type VerificationLevel = 'unverified' | 'kycVerified'

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
 * Freshness lifecycle of a Kyc, maintained by the periodic 現況確認 (liveness)
 * re-check. A revoked/changed result flags the Kyc for re-verification rather
 * than hard-locking the account.
 */
export type VerificationStatus = 'active' | 'needsReverification'

/**
 * The result of a fan's 本人確認 — only what the client renders. It carries NO
 * raw certificate, NO 個人番号, and NO serial; the `pocketSignUserId` is the
 * tenant-scoped person key the backend dedupes on.
 */
export interface Kyc {
	/** Server-generated id of the Kyc (a UUID). */
	readonly id: string
	/** The User this Kyc is bound to. */
	readonly userId: string
	readonly method: VerificationMethod
	/** The Pocket Sign person key (tenant-scoped). */
	readonly pocketSignUserId: string
	readonly dedupeStrength: DedupeStrength
	readonly status: VerificationStatus
	/** When the verification was established (epoch millis), when known. */
	readonly verifiedAt?: number
}

/**
 * The caller's 本人確認 snapshot: the account's level plus, when the fan has
 * passed KYC, their Kyc. This is the single shape the settings UI and the
 * lottery entry gate bind to.
 */
export interface KycStatus {
	readonly level: VerificationLevel
	/** The fan's Kyc. Absent when the fan never passed KYC. */
	readonly kyc?: Kyc
}

/**
 * The account level a Kyc backs. The backend derives the level from whether
 * an Active Kyc backs the account, so the client derives it the same way from
 * the Kyc it reads (`KycService.Get` does not return the level).
 */
export function verificationLevelOf(kyc: Kyc | undefined): VerificationLevel {
	return kyc?.status === 'active' ? 'kycVerified' : 'unverified'
}

/** i18n key for a verification level's human label. */
export function verificationLevelLabelKey(level: VerificationLevel): string {
	return level === 'kycVerified'
		? 'settings.kyc.levelVerified'
		: 'settings.kyc.levelUnverified'
}

/** i18n key for a verification method's human label. */
export function verificationMethodLabelKey(method: VerificationMethod): string {
	return method === 'jpki'
		? 'settings.kyc.methodJpki'
		: 'settings.kyc.methodDriverLicence'
}

/** i18n key for a dedupe-strength human label. */
export function dedupeStrengthLabelKey(strength: DedupeStrength): string {
	return strength === 'strong'
		? 'settings.kyc.dedupeStrong'
		: 'settings.kyc.dedupeWeak'
}
