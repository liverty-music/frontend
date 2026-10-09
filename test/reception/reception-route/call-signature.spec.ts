import { describe, expect, it } from 'vitest'
import {
	base64urlNoPad,
	buildReceptionSignatureInput,
	RECEPTION_SIGNATURE_CONTEXT,
} from '../../../reception/reception-route/call-signature'
import { receptionProcedure } from '../../../reception/services/reception-client'

const decode = (b: Uint8Array) => new TextDecoder().decode(b)

describe('reception call signature input', () => {
	it('is the five lines of reception_service.proto joined by "\\n", no trailing newline', () => {
		const bytes = buildReceptionSignatureInput({
			procedure:
				'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Admit',
			linkToken: 'tok_EN-123',
			signTime: 1_795_000_000,
			content: 'SCANNED TEXT',
		})
		expect(decode(bytes)).toBe(
			[
				'liverty-music.reception.v1',
				'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Admit',
				'tok_EN-123',
				'1795000000',
				'SCANNED TEXT',
			].join('\n'),
		)
		expect(bytes[bytes.length - 1]).not.toBe(0x0a)
		expect(RECEPTION_SIGNATURE_CONTEXT).toBe('liverty-music.reception.v1')
	})

	it('encodes the lines as UTF-8 and keeps the content exactly as given', () => {
		const bytes = buildReceptionSignatureInput({
			procedure: '/p',
			linkToken: 't',
			signTime: 0,
			content: '受付 \n x',
		})
		expect(Array.from(bytes)).toEqual(
			Array.from(
				new TextEncoder().encode(
					'liverty-music.reception.v1\n/p\nt\n0\n受付 \n x',
				),
			),
		)
	})

	it('writes the sign time as decimal Unix seconds only', () => {
		expect(() =>
			buildReceptionSignatureInput({
				procedure: '/p',
				linkToken: 't',
				signTime: 1.5,
				content: '',
			}),
		).toThrow()
		expect(() =>
			buildReceptionSignatureInput({
				procedure: '/p',
				linkToken: 't',
				signTime: -1,
				content: '',
			}),
		).toThrow()
	})

	it('names the full Connect procedure of Open and Admit', () => {
		expect(receptionProcedure('open')).toBe(
			'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Open',
		)
		expect(receptionProcedure('admit')).toBe(
			'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Admit',
		)
	})

	it('encodes the Open content as base64url without padding', () => {
		const key = new Uint8Array(65).map((_, i) => (i * 37 + 251) & 0xff)
		key[0] = 0x04
		const text = base64urlNoPad(key)
		expect(text).toMatch(/^[A-Za-z0-9_-]+$/)
		expect(text).toHaveLength(87) // ceil(65 * 4 / 3), no '='
		const back = Uint8Array.from(
			atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='),
			(c) => c.charCodeAt(0),
		)
		expect(back).toEqual(key)
		expect(base64urlNoPad(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
	})
})
