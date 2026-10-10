import { SellerDetailsSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
	bpsToPercentText,
	hasSellerDetailsErrors,
	parsePercentToBps,
	toSellerDetailsInput,
	trimSellerDetails,
	validateSellerDetails,
} from '../../../admin/organizers/organizer-commercial-terms/commercial-terms-form'

const VALID = {
	legalName: 'Liverty Records Inc.',
	representativeName: 'Taro Yamada',
	address: '1-2-3 Shibuya, Shibuya-ku, Tokyo',
	phoneNumber: '+81312345678',
	contactEmail: 'contact@liverty.example',
}

describe('bpsToPercentText', () => {
	it.each([
		[500, '5.00'],
		[3000, '30.00'],
		[800, '8.00'],
		[0, '0.00'],
		[1, '0.01'],
		[1234, '12.34'],
		[50, '0.50'],
	])('formats %i bps as %s', (bps, text) => {
		expect(bpsToPercentText(bps)).toBe(text)
	})
})

describe('parsePercentToBps', () => {
	it.each([
		['5.00', 500],
		['30.00', 3000],
		['30', 3000],
		['5', 500],
		['5.5', 550],
		['0', 0],
		['0.29', 29],
		['12.34', 1234],
		[' 8.00 ', 800],
	])('parses %s as %i bps', (text, bps) => {
		expect(parsePercentToBps(text)).toEqual({ ok: true, bps })
	})

	it('round-trips every formatted value', () => {
		for (const bps of [0, 1, 29, 500, 800, 2999, 3000]) {
			expect(parsePercentToBps(bpsToPercentText(bps))).toEqual({
				ok: true,
				bps,
			})
		}
	})

	it('rejects an empty value', () => {
		expect(parsePercentToBps('  ')).toEqual({
			ok: false,
			error: 'Enter a rate.',
		})
	})

	it.each(['5.001', 'abc', '-1', '5%', '5,00', '.5', '1e1'])(
		'rejects the malformed value %s',
		(text) => {
			const result = parsePercentToBps(text)
			expect(result.ok).toBe(false)
			if (result.ok === false) expect(result.error).toContain('two decimals')
		},
	)

	it.each(['30.01', '31', '100'])('rejects %s as above 30%%', (text) => {
		const result = parsePercentToBps(text)
		expect(result.ok).toBe(false)
		if (result.ok === false)
			expect(result.error).toContain('between 0% and 30%')
	})
})

describe('toSellerDetailsInput', () => {
	it('copies stored details', () => {
		expect(toSellerDetailsInput(create(SellerDetailsSchema, VALID))).toEqual(
			VALID,
		)
	})

	it('gives empty values when details are absent', () => {
		expect(toSellerDetailsInput(undefined)).toEqual({
			legalName: '',
			representativeName: '',
			address: '',
			phoneNumber: '',
			contactEmail: '',
		})
	})
})

describe('validateSellerDetails', () => {
	it('accepts complete, valid details', () => {
		expect(validateSellerDetails(VALID)).toEqual({})
	})

	it('requires all five values', () => {
		const errors = validateSellerDetails(
			trimSellerDetails({
				legalName: ' ',
				representativeName: '',
				address: '',
				phoneNumber: '',
				contactEmail: '',
			}),
		)
		expect(Object.keys(errors).sort()).toEqual([
			'address',
			'contactEmail',
			'legalName',
			'phoneNumber',
			'representativeName',
		])
	})

	it('enforces the maximum lengths in characters', () => {
		expect(
			validateSellerDetails({ ...VALID, legalName: 'あ'.repeat(200) }),
		).toEqual({})
		expect(
			validateSellerDetails({
				...VALID,
				legalName: 'a'.repeat(201),
				representativeName: 'a'.repeat(101),
				address: 'a'.repeat(301),
			}),
		).toEqual({
			legalName: 'The legal name must be 200 characters or fewer.',
			representativeName:
				'The representative name must be 100 characters or fewer.',
			address: 'The address must be 300 characters or fewer.',
		})
	})

	it.each([
		'03-1234-5678',
		'0312345678',
		'+0312345678',
		'+8',
		'+8131234567890123',
	])('rejects the non-E.164 phone number %s', (phoneNumber) => {
		expect(
			validateSellerDetails({ ...VALID, phoneNumber }).phoneNumber,
		).toContain('international form')
	})

	it.each(['not-an-email', 'a@', '@b.example', 'a b@c.example'])(
		'rejects the email %s',
		(contactEmail) => {
			expect(
				validateSellerDetails({ ...VALID, contactEmail }).contactEmail,
			).toBe('Enter a valid email address.')
		},
	)
})

describe('hasSellerDetailsErrors', () => {
	it('ignores fields present with an undefined message', () => {
		expect(hasSellerDetailsErrors({})).toBe(false)
		expect(
			hasSellerDetailsErrors({ legalName: undefined, address: undefined }),
		).toBe(false)
		expect(hasSellerDetailsErrors({ address: 'Enter the address.' })).toBe(true)
	})
})
