import { describe, expect, it, vi } from 'vitest'
import { createLongFrameReporter } from './long-frame-reporter'

describe('createLongFrameReporter', () => {
	it('reports frames of 100 ms or more with their top script', () => {
		const capture = vi.fn()
		const report = createLongFrameReporter(capture, () => '/discovery', 20)

		report([
			{ duration: 80 },
			{
				duration: 120.4,
				scripts: [{ sourceFunctionName: 'loop', sourceURL: 'app.js' }],
			},
		])

		expect(capture).toHaveBeenCalledOnce()
		expect(capture).toHaveBeenCalledWith({
			duration_ms: 120,
			top_function: 'loop',
			top_script: 'app.js',
			route: '/discovery',
		})
	})

	it('stops after the per-page limit', () => {
		const capture = vi.fn()
		const report = createLongFrameReporter(capture, () => '/discovery', 3)

		report(Array.from({ length: 5 }, () => ({ duration: 150 })))
		report([{ duration: 150 }])

		expect(capture).toHaveBeenCalledTimes(3)
	})
})
