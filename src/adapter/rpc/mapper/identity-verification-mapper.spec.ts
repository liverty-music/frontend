import {
	IdentityVerificationSchema,
	DedupeStrength as ProtoDedupeStrength,
	type IdentityVerification as ProtoIdentityVerification,
	VerificationMethod as ProtoVerificationMethod,
	VerificationStatus as ProtoVerificationStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/identity_verification_pb.js'
import { create } from '@bufbuild/protobuf'
import { TimestampSchema } from '@bufbuild/protobuf/wkt'
import { describe, expect, it } from 'vitest'
import {
	identityVerificationFrom,
	verificationMethodTo,
} from './identity-verification-mapper'

function makeProtoIdentityVerification(
	overrides: Partial<{
		method: ProtoVerificationMethod
		dedupeStrength: ProtoDedupeStrength
		status: ProtoVerificationStatus
		id: string
		userId: string
		providerUserId: string
		verifyTimeSeconds: bigint
	}> = {},
): ProtoIdentityVerification {
	return create(IdentityVerificationSchema, {
		id: { value: overrides.id ?? 'vi-1' },
		userId: { value: overrides.userId ?? 'user-1' },
		method: overrides.method ?? ProtoVerificationMethod.JPKI,
		providerUserId: {
			value: overrides.providerUserId ?? 'provider-user-1',
		},
		dedupeStrength: overrides.dedupeStrength ?? ProtoDedupeStrength.STRONG,
		status: overrides.status ?? ProtoVerificationStatus.ACTIVE,
		verifyTime:
			overrides.verifyTimeSeconds !== undefined
				? create(TimestampSchema, { seconds: overrides.verifyTimeSeconds })
				: undefined,
	})
}

describe('identity-verification-mapper', () => {
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

	describe('identityVerificationFrom', () => {
		it('returns undefined for an absent message', () => {
			expect(identityVerificationFrom(undefined)).toBeUndefined()
		})

		it('maps a fully-populated JPKI identity', () => {
			const result = identityVerificationFrom(
				makeProtoIdentityVerification({
					verifyTimeSeconds: BigInt(1_700_000_000),
				}),
			)
			expect(result).toEqual({
				id: 'vi-1',
				userId: 'user-1',
				method: 'jpki',
				providerUserId: 'provider-user-1',
				dedupeStrength: 'strong',
				status: 'active',
				verifyTime: 1_700_000_000 * 1000,
			})
		})

		it('maps a driver-licence weak-dedupe identity needing re-verification', () => {
			const result = identityVerificationFrom(
				makeProtoIdentityVerification({
					method: ProtoVerificationMethod.DRIVER_LICENCE,
					dedupeStrength: ProtoDedupeStrength.WEAK,
					status: ProtoVerificationStatus.NEEDS_REVERIFICATION,
				}),
			)
			expect(result?.method).toBe('driverLicence')
			expect(result?.dedupeStrength).toBe('weak')
			expect(result?.status).toBe('needsReverification')
		})

		it('leaves verifyTime undefined when the timestamp is absent', () => {
			const result = identityVerificationFrom(makeProtoIdentityVerification())
			expect(result?.verifyTime).toBeUndefined()
		})

		it('returns undefined when the method is unspecified (half-populated record)', () => {
			expect(
				identityVerificationFrom(
					makeProtoIdentityVerification({
						method: ProtoVerificationMethod.UNSPECIFIED,
					}),
				),
			).toBeUndefined()
		})

		it('returns undefined when the dedupe strength is unspecified', () => {
			expect(
				identityVerificationFrom(
					makeProtoIdentityVerification({
						dedupeStrength: ProtoDedupeStrength.UNSPECIFIED,
					}),
				),
			).toBeUndefined()
		})

		it('returns undefined when the status is unspecified (never render an unknown lifecycle as active)', () => {
			expect(
				identityVerificationFrom(
					makeProtoIdentityVerification({
						status: ProtoVerificationStatus.UNSPECIFIED,
					}),
				),
			).toBeUndefined()
		})

		it('returns undefined when the provider user id is empty', () => {
			expect(
				identityVerificationFrom(
					makeProtoIdentityVerification({ providerUserId: '' }),
				),
			).toBeUndefined()
		})
	})
})
