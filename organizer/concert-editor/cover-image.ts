/**
 * Client-side cover-image validation, mirroring the backend's accepted types
 * and size bound so an operator gets immediate feedback before the upload
 * round-trips. The server remains the source of truth (it re-validates); this
 * is a UX pre-check.
 */

/** Accepted IANA image media types (jpeg / png / webp). */
export const ACCEPTED_IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const

/** Maximum accepted image size: 10 MiB (matches the server bound). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** A failed validation carries user-facing copy; a pass carries nothing. */
export type CoverImageValidation =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string }

/** Validates a picked file's content type and size against the accepted bounds. */
export function validateCoverImage(file: {
	type: string
	size: number
}): CoverImageValidation {
	if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return {
			ok: false,
			message: 'Choose a JPEG, PNG, or WebP image.',
		}
	}
	if (file.size > MAX_IMAGE_BYTES) {
		return {
			ok: false,
			message: 'The image must be 10 MiB or smaller.',
		}
	}
	return { ok: true }
}

/** Reads a `File` (or `Blob`) into a `Uint8Array` for the upload RPC. */
export async function readFileBytes(file: Blob): Promise<Uint8Array> {
	const buffer = await file.arrayBuffer()
	return new Uint8Array(buffer)
}
