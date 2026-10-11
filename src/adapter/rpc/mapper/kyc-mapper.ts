import {
	DedupeStrength as ProtoDedupeStrength,
	type Kyc as ProtoKyc,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/kyc_pb.js'
import { VerificationLevel as ProtoVerificationLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { timestampMs } from '@bufbuild/protobuf/wkt'
import type {
	DedupeStrength,
	Kyc,
	VerificationLevel,
	VerificationMethod,
	VerificationStatus,
} from '../../../entities/kyc'

/**
 * Wire ⇄ domain mapping for the fan's Kyc. Mirrors `ticket-journey-mapper`: the
 * RPC boundary is the only place the generated numeric proto enums are
 * touched; the domain layer sees string-literal unions.
 *
 * The `*To` direction (domain → proto) is provided for `VerificationMethod`
 * because `KycService.Start` sends it up; the other enums are output-only
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
	[ProtoVerificationLevel.KYC_VERIFIED]: 'kycVerified',
}

/**
 * Map the account verification level. Anything other than a concrete
 * `KYC_VERIFIED` (UNSPECIFIED, UNVERIFIED, or an unknown future value)
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
 * Map a `Kyc` proto to the domain shape. Returns `undefined` when the message
 * is absent or carries an unrecognized/unspecified method, dedupe strength, or
 * status — the caller then treats the account as unverified rather than
 * surfacing a half-populated record.
 */
export function kycFrom(proto: ProtoKyc | undefined): Kyc | undefined {
	if (!proto) return undefined

	const method = methodFromProto[proto.method]
	const dedupeStrength = dedupeFromProto[proto.dedupeStrength]
	const status = statusFromProto[proto.status]
	const id = proto.id?.value
	const userId = proto.userId?.value
	const pocketSignUserId = proto.pocketSignUserId?.value

	if (
		!method ||
		!dedupeStrength ||
		!status ||
		!id ||
		!userId ||
		!pocketSignUserId
	) {
		return undefined
	}

	return {
		id,
		userId,
		method,
		pocketSignUserId,
		dedupeStrength,
		status,
		verifiedAt: proto.verifyTime ? timestampMs(proto.verifyTime) : undefined,
	}
}
