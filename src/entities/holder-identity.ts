/**
 * The 本人確認 (identity check) a fan gives when they apply for a lottery or
 * check out: the name printed on the tickets and checked at entry, and a
 * contact phone number.
 *
 * @source proto/liverty_music/entity/v1/holder_identity.proto — HolderIdentity
 */
export interface HolderIdentity {
	/** The fan's real full name (氏名). */
	readonly fullName: string
	/** A contact phone number in E.164 form. */
	readonly phoneNumber: string
}
