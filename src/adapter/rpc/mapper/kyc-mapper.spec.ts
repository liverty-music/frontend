import {
	KycSchema,
	DedupeStrength as ProtoDedupeStrength,
	type Kyc as ProtoKyc,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/kyc_pb.js'
import { VerificationLevel as ProtoVerificationLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { create } from '@bufbuild/protobuf'
import { TimestampSchema } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	kycFrom,
	verificationLevelFrom,
	verificationMethodTo,
} from './kyc-mapper'

function makeProtoKyc(
	overrides: Partial<{
		method: ProtoVerificationMethod
		dedupeStrength: ProtoDedupeStrength
		status: ProtoVerificationStatus
		id: string
		userId: string
		pocketSignUserId: string
		verifiedAtSeconds: bigint
	}> = {},
): ProtoKyc {
	return create(KycSchema, {
		id: { value: overrides.id ?? 'vi-1' },
		userId: { value: overrides.userId ?? 'user-1' },
		method: overrides.method ?? ProtoVerificationMethod.JPKI,
		pocketSignUserId: {
			value: overrides.pocketSignUserId ?? 'ps-user-1',
		},
		dedupeStrength: overrides.dedupeStrength ?? ProtoDedupeStrength.STRONG,
		status: overrides.status ?? ProtoVerificationStatus.ACTIVE,
		verifyTime:
			overrides.verifiedAtSeconds !== undefined
				? create(TimestampSchema, { seconds: overrides.verifiedAtSeconds })
				: undefined,
	})
}

describe('kyc-mapper', () => {
	describe('verificationLevelFrom', () => {
		it('maps KYC_VERIFIED', () => {
			expect(verificationLevelFrom(ProtoVerificationLevel.KYC_VERIFIED)).toBe(
				'kycVerified',
			)
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

	describe('kycFrom', () => {
		it('returns undefined for an absent message', () => {
			expect(kycFrom(undefined)).toBeUndefined()
		})

		it('maps a fully-populated JPKI identity', () => {
			const result = kycFrom(
				makeProtoKyc({ verifiedAtSeconds: BigInt(1_700_000_000) }),
			)
			expect(result).toEqual({
				id: 'vi-1',
				userId: 'user-1',
				method: 'jpki',
				pocketSignUserId: 'ps-user-1',
				dedupeStrength: 'strong',
				status: 'active',
				verifiedAt: 1_700_000_000 * 1000,
			})
		})

		it('maps a driver-licence weak-dedupe identity needing re-verification', () => {
			const result = kycFrom(
				makeProtoKyc({
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
			const result = kycFrom(makeProtoKyc())
			expect(result?.verifiedAt).toBeUndefined()
		})

		it('returns undefined when the method is unspecified (half-populated record)', () => {
			expect(
				kycFrom(makeProtoKyc({ method: ProtoVerificationMethod.UNSPECIFIED })),
			).toBeUndefined()
		})

		it('returns undefined when the dedupe strength is unspecified', () => {
			expect(
				kycFrom(
					makeProtoKyc({
						dedupeStrength: ProtoDedupeStrength.UNSPECIFIED,
					}),
				),
			).toBeUndefined()
		})

		it('returns undefined when the status is unspecified (never render an unknown lifecycle as active)', () => {
			expect(
				kycFrom(makeProtoKyc({ status: ProtoVerificationStatus.UNSPECIFIED })),
			).toBeUndefined()
		})

		it('returns undefined when the pocket-sign user id is empty', () => {
			expect(kycFrom(makeProtoKyc({ pocketSignUserId: '' }))).toBeUndefined()
		})
	})
})
