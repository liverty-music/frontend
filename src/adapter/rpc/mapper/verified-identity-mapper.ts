import { VerificationLevel as ProtoVerificationLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import {
	DedupeStrength as ProtoDedupeStrength,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
	type VerifiedIdentity as ProtoVerifiedIdentity,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/verified_identity_pb.js'
import type {
	DedupeStrength,
	VerificationLevel,
	VerificationMethod,
	VerificationStatus,
	VerifiedIdentity,
} from '../../../entities/verified-identity'

/**
 * Wire ⇄ domain mapping for the identity-ekyc verification result. Mirrors
 * `ticket-journey-mapper`: the RPC boundary is the only place the generated
 * numeric proto enums are touched; the domain layer sees string-literal unions.
 *
 * The `*To` direction (domain → proto) is provided for `VerificationMethod`
 * because `startVerify(method)` sends it up; the other enums are output-only
 * (server-owned) so they only need the `*From` direction.
 */

const methodFromProto: Record<number, VerificationMethod | undefined> = {
	[ProtoVerificationMethod.JPKI]: 'jpki',
	[ProtoVerificationMethod.DRIVER_LICENCE]: 'driverLicence',
}

const methodToProto: Record<VerificationMethod, ProtoVerificationMethod> = {
	jpki: ProtoVerificationMethod.JPKI,
	driverLicence: ProtoVerificationMethod.DRIVER_LICENCE,
}

const dedupeFromProto: Record<number, DedupeStrength | undefined> = {
	[ProtoDedupeStrength.STRONG]: 'strong',
	[ProtoDedupeStrength.WEAK]: 'weak',
}

const statusFromProto: Record<number, VerificationStatus | undefined> = {
	[ProtoVerificationStatus.ACTIVE]: 'active',
	[ProtoVerificationStatus.NEEDS_REVERIFICATION]: 'needsReverification',
}

const levelFromProto: Record<number, VerificationLevel> = {
	[ProtoVerificationLevel.UNVERIFIED]: 'unverified',
	[ProtoVerificationLevel.IDENTITY_VERIFIED]: 'identityVerified',
}

/**
 * Map the account verification level. Anything other than a concrete
 * `IDENTITY_VERIFIED` (UNSPECIFIED, UNVERIFIED, or an unknown future value)
 * degrades safely to `unverified` — the client must never render an
 * unrecognized level as verified.
 */
export function verificationLevelFrom(
	proto: ProtoVerificationLevel,
): VerificationLevel {
	return levelFromProto[proto] ?? 'unverified'
}

/** Domain → proto for the method the fan chose to verify with. */
export function verificationMethodTo(
	method: VerificationMethod,
): ProtoVerificationMethod {
	return methodToProto[method]
}

/**
 * Map a `VerifiedIdentity` proto to the domain shape. Returns `undefined` when
 * the message is absent or carries an unrecognized/unspecified method, dedupe
 * strength, or status — the caller then treats the account as unverified rather
 * than surfacing a half-populated record.
 */
export function verifiedIdentityFrom(
	proto: ProtoVerifiedIdentity | undefined,
): VerifiedIdentity | undefined {
	if (!proto) return undefined

	const method = methodFromProto[proto.method]
	const dedupeStrength = dedupeFromProto[proto.dedupeStrength]
	const status = statusFromProto[proto.status]
	const id = proto.id?.value
	const accountRef = proto.accountRef?.value
	const pocketSignUserId = proto.pocketSignUserId?.value

	if (
		!method ||
		!dedupeStrength ||
		!status ||
		!id ||
		!accountRef ||
		!pocketSignUserId
	) {
		return undefined
	}

	return {
		id,
		accountRef,
		method,
		pocketSignUserId,
		dedupeStrength,
		status,
		// Timestamp is seconds (bigint) + nanos; millis is enough for display.
		verifiedAt: proto.verifiedAt
			? Number(proto.verifiedAt.seconds) * 1000
			: undefined,
	}
}
