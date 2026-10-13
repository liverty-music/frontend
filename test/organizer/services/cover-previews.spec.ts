import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	COVER_POLL_LIMIT_MS,
	COVER_POLL_MS,
	CoverPreviews,
	watchCover,
} from '../../../organizer/services/cover-previews'

describe('CoverPreviews', () => {
	let created = 0
	const revoked: string[] = []

	beforeEach(() => {
		created = 0
		revoked.length = 0
		vi.spyOn(URL, 'createObjectURL').mockImplementation(
			() => `blob:preview-${++created}`,
		)
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
			revoked.push(url)
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('keeps the picked image until the Series serves the uploaded cover', () => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Saved before processing finished"
		const covers = new CoverPreviews()
		const held = covers.hold('s-solo', 'img-new', new Blob(['png']))
		expect(held.previewUrl).toBe('blob:preview-1')

		// The previous cover is still served: the preview stays.
		expect(covers.settle('s-solo', 'img-old')).toBe(held)
		expect(covers.settle('s-solo', undefined)).toBe(held)
		expect(revoked).toEqual([])

		// The uploaded image is served: the preview is released.
		expect(covers.settle('s-solo', 'img-new')).toBeUndefined()
		expect(revoked).toEqual(['blob:preview-1'])
		expect(covers.settle('s-solo', 'img-old')).toBeUndefined()
	})

	it('replaces the preview of a second pick and releases the first', () => {
		const covers = new CoverPreviews()
		covers.hold('s-solo', 'img-1', new Blob(['a']))
		const second = covers.hold('s-solo', 'img-2', new Blob(['b']))
		expect(revoked).toEqual(['blob:preview-1'])
		expect(covers.settle('s-solo', 'img-1')).toBe(second)
	})

	it('keeps each Series apart', () => {
		const covers = new CoverPreviews()
		covers.hold('s-a', 'img-a', new Blob(['a']))
		expect(covers.settle('s-b', 'img-a')).toBeUndefined()
		expect(covers.settle('s-a', 'img-b')?.seriesImageId).toBe('img-a')
	})
})

describe('watchCover', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('re-reads every 3 s until the processed cover is served', async () => {
		const reads: string[] = ['img-old', 'img-old', 'img-new']
		const read = vi.fn(async () => reads.shift())
		const slow = vi.fn()
		watchCover({
			read,
			served: (id) => id === 'img-new',
			slow,
			now: () => Date.now(),
		})
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS - 1)
		expect(read).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(read).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS * 5)
		expect(read).toHaveBeenCalledTimes(3)
		expect(slow).not.toHaveBeenCalled()
	})

	it('says it takes longer after 60 s and stops reading', async () => {
		const read = vi.fn(async () => 'img-old')
		const slow = vi.fn()
		watchCover({ read, served: () => false, slow, now: () => Date.now() })
		await vi.advanceTimersByTimeAsync(COVER_POLL_LIMIT_MS + COVER_POLL_MS)
		expect(slow).toHaveBeenCalledTimes(1)
		const count = read.mock.calls.length
		expect(count).toBe(COVER_POLL_LIMIT_MS / COVER_POLL_MS)
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS * 5)
		expect(read).toHaveBeenCalledTimes(count)
	})

	it('tries again after a failed read', async () => {
		const read = vi
			.fn<() => Promise<string | undefined>>()
			.mockRejectedValueOnce(new Error('unavailable'))
			.mockResolvedValue('img-new')
		const served = vi.fn((id: string | undefined) => id === 'img-new')
		watchCover({ read, served, slow: vi.fn(), now: () => Date.now() })
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS * 2)
		expect(read).toHaveBeenCalledTimes(2)
		expect(served).toHaveBeenCalledWith('img-new')
	})

	it('reads no more once stopped (the screen is left)', async () => {
		const read = vi.fn(async () => 'img-old')
		const stop = watchCover({
			read,
			served: () => false,
			slow: vi.fn(),
			now: () => Date.now(),
		})
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS)
		stop()
		await vi.advanceTimersByTimeAsync(COVER_POLL_MS * 5)
		expect(read).toHaveBeenCalledTimes(1)
	})
})
