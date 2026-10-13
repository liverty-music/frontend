import { describe, expect, it } from 'vitest'
import { PageProgress } from '../../../organizer/shell/page-progress'

describe('PageProgress', () => {
	it('is busy while any tracked read runs', async () => {
		const progress = new PageProgress()
		let finishFirst!: () => void
		const first = progress.track(
			new Promise<void>((resolve) => {
				finishFirst = resolve
			}),
		)
		const second = progress.track(Promise.reject(new Error('down')))
		expect(progress.busy).toBe(true)

		await expect(second).rejects.toThrow('down')
		expect(progress.busy).toBe(true)

		finishFirst()
		await first
		expect(progress.busy).toBe(false)
	})

	it('returns the result of the work', async () => {
		await expect(new PageProgress().track(Promise.resolve(42))).resolves.toBe(
			42,
		)
	})
})
