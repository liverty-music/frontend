/**
 * The reception call signature input (rpc.organizer.reception.v1.ReceptionService):
 * the UTF-8 bytes of five lines joined by a single "\n", with no trailing
 * newline:
 *
 *   liverty-music.reception.v1
 *   <Connect procedure, e.g. /liverty_music.rpc.organizer.reception.v1.ReceptionService/Admit>
 *   <link token>
 *   <sign_time as decimal Unix seconds>
 *   <call content>
 *
 * The call content is, for Open, the device public key's 65 bytes in base64url
 * without padding; for Admit, the scanned text exactly as sent. The device
 * signs these bytes with ECDSA P-256 / SHA-256, which WebCrypto returns in the
 * IEEE P1363 `r || s` form the server expects.
 */

/** The first line of every reception call signature input. */
export const RECEPTION_SIGNATURE_CONTEXT = 'liverty-music.reception.v1'

/** ECDSA over P-256 with SHA-256, as the server verifies reception calls. */
export const RECEPTION_SIGN_ALGORITHM: EcdsaParams = {
	name: 'ECDSA',
	hash: 'SHA-256',
}

export interface ReceptionCallSignatureInput {
	/** The full Connect procedure path, starting with `/`. */
	readonly procedure: string
	readonly linkToken: string
	/** Unix seconds by the device's clock. */
	readonly signTime: number
	readonly content: string
}

/** The bytes a reception call signature covers. */
export function buildReceptionSignatureInput(
	input: ReceptionCallSignatureInput,
): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(input.signTime) || input.signTime < 0) {
		throw new Error(`sign time must be whole Unix seconds: ${input.signTime}`)
	}
	const text = [
		RECEPTION_SIGNATURE_CONTEXT,
		input.procedure,
		input.linkToken,
		String(input.signTime),
		input.content,
	].join('\n')
	return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
}

/** Base64url without padding (RFC 4648 §5), as the Open call content uses. */
export function base64urlNoPad(bytes: Uint8Array): string {
	let binary = ''
	for (const b of bytes) binary += String.fromCharCode(b)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
