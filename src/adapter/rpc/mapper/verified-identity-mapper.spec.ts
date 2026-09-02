import {
	VerificationLevel as ProtoVerificationLevel,
	UserId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import {
	PocketSignUserId,
	DedupeStrength as ProtoDedupeStrength,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
	VerifiedIdentity as ProtoVerifiedIdentity,
	VerifiedIdentityId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/verified_identity_pb.js'
import { Timestamp } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
	verificationLevelFrom,
	verificationMethodTo,
	verifiedIdentityFrom,
} from './verified-identity-mapper'

function makeProtoIdentity(
	overrides: Partial<{
		method: ProtoVerificationMethod
		dedupeStrength: ProtoDedupeStrength
		status: ProtoVerificationStatus
		id: string
		accountRef: string
		pocketSignUserId: string
		verifiedAtSeconds: bigint
	}> = {},
): ProtoVerifiedIdentity {
	return new ProtoVerifiedIdentity({
		id: new VerifiedIdentityId({ value: overrides.id ?? 'vi-1' }),
		accountRef: new UserId({ value: overrides.accountRef ?? 'user-1' }),
		method: overrides.method ?? ProtoVerificationMethod.JPKI,
		pocketSignUserId: new PocketSignUserId({
			value: overrides.pocketSignUserId ?? 'ps-user-1',
		}),
		dedupeStrength: overrides.dedupeStrength ?? ProtoDedupeStrength.STRONG,
		status: overrides.status ?? ProtoVerificationStatus.ACTIVE,
		verifiedAt:
			overrides.verifiedAtSeconds !== undefined
				? new Timestamp({ seconds: overrides.verifiedAtSeconds })
				: undefined,
	})
}

describe('verified-identity-mapper', () => {
	describe('verificationLevelFrom', () => {
		it('maps IDENTITY_VERIFIED', () => {
			expect(
				verificationLevelFrom(ProtoVerificationLevel.IDENTITY_VERIFIED),
			).toBe('identityVerified')
		})

		it('maps UNVERIFIED', () => {
			expect(verificationLevelFrom(ProtoVerificationLevel.UNVERIFIED)).toBe(
				'unverified',
			)
		})

		it('degrades UNSPECIFIED to unverified (never render unknown as verified)', () => {
			expect(verificationLevelFrom(ProtoVerificationLevel.UNSPECIFIED)).toBe(
				'unverified',
			)
		})

		it('degrades an unknown future value to unverified', () => {
			expect(verificationLevelFrom(999 as ProtoVerificationLevel)).toBe(
				'unverified',
			)
		})
	})

	describe('verificationMethodTo', () => {
		it('maps jpki → JPKI', () => {
			expect(verificationMethodTo('jpki')).toBe(ProtoVerificationMethod.JPKI)
		})

		it('maps driverLicence → DRIVER_LICENCE', () => {
			expect(verificationMethodTo('driverLicence')).toBe(
				ProtoVerificationMethod.DRIVER_LICENCE,
			)
		})
	})

	describe('verifiedIdentityFrom', () => {
		it('returns undefined for an absent message', () => {
			expect(verifiedIdentityFrom(undefined)).toBeUndefined()
		})

		it('maps a fully-populated JPKI identity', () => {
			const result = verifiedIdentityFrom(
				makeProtoIdentity({ verifiedAtSeconds: BigInt(1_700_000_000) }),
			)
			expect(result).toEqual({
				id: 'vi-1',
				accountRef: 'user-1',
				method: 'jpki',
				pocketSignUserId: 'ps-user-1',
				dedupeStrength: 'strong',
				status: 'active',
				verifiedAt: 1_700_000_000 * 1000,
			})
		})

		it('maps a driver-licence weak-dedupe identity needing re-verification', () => {
			const result = verifiedIdentityFrom(
				makeProtoIdentity({
					method: ProtoVerificationMethod.DRIVER_LICENCE,
					dedupeStrength: ProtoDedupeStrength.WEAK,
					status: ProtoVerificationStatus.NEEDS_REVERIFICATION,
				}),
			)
			expect(result?.method).toBe('driverLicence')
			expect(result?.dedupeStrength).toBe('weak')
			expect(result?.status).toBe('needsReverification')
		})

		it('leaves verifiedAt undefined when the timestamp is absent', () => {
			const result = verifiedIdentityFrom(makeProtoIdentity())
			expect(result?.verifiedAt).toBeUndefined()
		})

		it('returns undefined when the method is unspecified (half-populated record)', () => {
			expect(
				verifiedIdentityFrom(
					makeProtoIdentity({ method: ProtoVerificationMethod.UNSPECIFIED }),
				),
			).toBeUndefined()
		})

		it('returns undefined when the dedupe strength is unspecified', () => {
			expect(
				verifiedIdentityFrom(
					makeProtoIdentity({
						dedupeStrength: ProtoDedupeStrength.UNSPECIFIED,
					}),
				),
			).toBeUndefined()
		})

		it('returns undefined when the pocket-sign user id is empty', () => {
			expect(
				verifiedIdentityFrom(makeProtoIdentity({ pocketSignUserId: '' })),
			).toBeUndefined()
		})
	})
})
