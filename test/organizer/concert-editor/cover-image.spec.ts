import { describe, expect, it } from 'vitest'
import {
	MAX_IMAGE_BYTES,
	readFileBytes,
	validateCoverImage,
} from '../../../organizer/concert-editor/cover-image'

describe('validateCoverImage', () => {
	it('accepts a small JPEG', () => {
		expect(validateCoverImage({ type: 'image/jpeg', size: 1024 })).toEqual({
			ok: true,
		})
	})

	it('accepts PNG and WebP', () => {
		expect(validateCoverImage({ type: 'image/png', size: 1 }).ok).toBe(true)
		expect(validateCoverImage({ type: 'image/webp', size: 1 }).ok).toBe(true)
	})

	it('rejects an unsupported type', () => {
		const result = validateCoverImage({ type: 'image/gif', size: 1 })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.message).toContain('JPEG')
	})

	it('rejects a file over the size limit', () => {
		const result = validateCoverImage({
			type: 'image/png',
			size: MAX_IMAGE_BYTES + 1,
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.message).toContain('10 MiB')
	})

	it('accepts a file exactly at the size limit', () => {
		expect(
			validateCoverImage({ type: 'image/png', size: MAX_IMAGE_BYTES }).ok,
		).toBe(true)
	})
})

describe('readFileBytes', () => {
	it('reads a Blob into a Uint8Array', async () => {
		// jsdom's Blob lacks arrayBuffer(); provide a minimal Blob-like stub that
		// honours the same contract the browser File implements.
		const source = new Uint8Array([1, 2, 3])
		const blobLike = {
			arrayBuffer: () => Promise.resolve(source.buffer),
		} as unknown as Blob
		const bytes = await readFileBytes(blobLike)
		expect(bytes).toBeInstanceOf(Uint8Array)
		expect(Array.from(bytes)).toEqual([1, 2, 3])
	})
})
