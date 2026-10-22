/**
 * What the platform recorded about one of the fan's passkeys when it was
 * added (OpenSpec change `fan-passkey-recovery-and-management`, design D7).
 * The identity provider stays the authority on which passkeys exist; a
 * record only adds the provider name and the date to one of them.
 */
export interface PasskeyRecord {
	/** The identity provider's passkey id, the key that joins the two lists. */
	readonly id: string
	/** The passkey provider (e.g. "Google Password Manager"), when known. */
	readonly providerName?: string
	/** When the passkey was added. */
	readonly createTime?: Date
}
