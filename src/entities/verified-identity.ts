/**
 * Account-level identity-verification domain model (identity-ekyc-jpki).
 *
 * This is the platform's own, generated-proto-free view of a
 * `VerifiedIdentity` and its surrounding account verification level. It binds
 * one account to a verified real person established via マイナンバーカード
 * 公的個人認証 (JPKI) — or the 運転免許証 IC fallback — through Pocket Sign
 * (PocketSign Verify). The frontend only ever reads the *result* of a
 * verification (level + method + dedupe strength + freshness); it never handles
 * the raw certificate, the 個人番号, or the certificate serial.
 *
 * Keeping these as plain string-literal unions (rather than re-exporting the
 * generated numeric enums) mirrors the `JourneyStatus` pattern in
 * `entities/concert.ts`: the domain layer stays free of generated-proto imports
 * and the wire mapping lives in the RPC mapper.
 *
 * @source proto/liverty_music/entity/v1/verified_identity.proto — VerifiedIdentity
 * @source proto/liverty_music/entity/v1/user.proto — VerificationLevel
 */

/**
 * Account-level identity assurance surfaced to ④ lottery-application and ⑤
 * ticket-purchase. Verification is a *lane*, not a universal mandate, so most
 * accounts sit at `unverified`.
 */
export type VerificationLevel = 'unverified' | 'identityVerified'

/**
 * How a person proved their identity. Drives the dedupe guarantee and whether a
 * JPKI-only event admits the verification.
 * - `jpki` — マイナンバーカード 公的個人認証 (high assurance, STRONG dedupe).
 * - `driverLicence` — 運転免許証 IC fallback (proves identity, WEAK dedupe).
 */
export type VerificationMethod = 'jpki' | 'driverLicence'

/**
 * Strength of the "one person = one account" guarantee a verification carries.
 * Follows from the method: JPKI yields a stable per-person key (`strong`); the
 * licence fallback yields only a document-scoped id that can change (`weak`).
 */
export type DedupeStrength = 'strong' | 'weak'

/**
 * Freshness lifecycle of a verification, maintained by the periodic 現況確認
 * (liveness) re-check. A revoked/changed result flags the record for
 * re-verification rather than hard-locking the account.
 */
export type VerificationStatus = 'active' | 'needsReverification'

/**
 * The result of an account verification — only what the client renders. Absent
 * (`undefined`) alongside a `unverified` level means the account has never
 * verified. Notably it carries NO raw certificate, NO 個人番号, and NO serial;
 * the `pocketSignUserId` is the tenant-scoped person key the backend dedupes on
 * and is exposed here only so ④/⑤ consumers can read it later.
 */
export interface VerifiedIdentity {
	/** Server-generated surrogate id for the verification record (a UUID). */
	readonly id: string
	/** The account (user) this verification is bound to. */
	readonly accountRef: string
	readonly method: VerificationMethod
	/**
	 * The Pocket Sign person key (tenant-scoped). The only person key the
	 * platform retains — never the serial or 個人番号. Present so ④/⑤ can enforce
	 * per-verified-person limits across accounts sharing it.
	 */
	readonly pocketSignUserId: string
	readonly dedupeStrength: DedupeStrength
	readonly status: VerificationStatus
	/** When the verification was established (epoch millis), when known. */
	readonly verifiedAt?: number
}

/**
 * The caller's verification snapshot as returned by `getMyVerificationStatus`:
 * the account-level level plus, when verified, the backing identity. This is the
 * single shape the settings UI binds to.
 */
export interface MyVerificationStatus {
	readonly level: VerificationLevel
	/** The backing verification. Absent when `level` is `unverified`. */
	readonly identity?: VerifiedIdentity
}

/** i18n key for a verification level's human label. */
export function verificationLevelLabelKey(level: VerificationLevel): string {
	return level === 'identityVerified'
		? 'settings.identity.levelVerified'
		: 'settings.identity.levelUnverified'
}

/** i18n key for a verification method's human label. */
export function verificationMethodLabelKey(method: VerificationMethod): string {
	return method === 'jpki'
		? 'settings.identity.methodJpki'
		: 'settings.identity.methodDriverLicence'
}

/** i18n key for a dedupe-strength human label. */
export function dedupeStrengthLabelKey(strength: DedupeStrength): string {
	return strength === 'strong'
		? 'settings.identity.dedupeStrong'
		: 'settings.identity.dedupeWeak'
}
