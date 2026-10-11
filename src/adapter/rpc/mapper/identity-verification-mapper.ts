import {
	DedupeStrength as ProtoDedupeStrength,
	type IdentityVerification as ProtoIdentityVerification,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/identity_verification_pb.js'
import { timestampMs } from '@bufbuild/protobuf/wkt'
import type {
	DedupeStrength,
	IdentityVerification,
	VerificationMethod,
	VerificationStatus,
} from '../../../entities/identity-verification'

/**
 * Wire ⇄ domain mapping for the fan's IdentityVerification. Mirrors
 * `ticket-journey-mapper`: the RPC boundary is the only place the generated
 * numeric proto enums are touched; the domain layer sees string-literal unions.
 *
 * The `*To` direction (domain → proto) is provided for `VerificationMethod`
 * because `IdentityVerificationService.Start` sends it up; the other enums are
 * output-only (server-owned) so they only need the `*From` direction.
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

/** Domain → proto for the method the fan chose to verify with. */
export function verificationMethodTo(
	method: VerificationMethod,
): ProtoVerificationMethod {
	return methodToProto[method]
}

/**
 * Map an `IdentityVerification` proto to the domain shape. Returns `undefined`
 * when the message is absent or carries an unrecognized/unspecified method,
 * dedupe strength, or status — the caller then treats the account as
 * unverified rather than surfacing a half-populated record.
 */
export function identityVerificationFrom(
	proto: ProtoIdentityVerification | undefined,
): IdentityVerification | undefined {
	if (!proto) return undefined

	const method = methodFromProto[proto.method]
	const dedupeStrength = dedupeFromProto[proto.dedupeStrength]
	const status = statusFromProto[proto.status]
	const id = proto.id?.value
	const userId = proto.userId?.value
	const providerUserId = proto.providerUserId?.value

	if (
		!method ||
		!dedupeStrength ||
		!status ||
		!id ||
		!userId ||
		!providerUserId
	) {
		return undefined
	}

	return {
		id,
		userId,
		method,
		providerUserId,
		dedupeStrength,
		status,
		verifyTime: proto.verifyTime ? timestampMs(proto.verifyTime) : undefined,
	}
}
