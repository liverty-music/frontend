import { describe, expect, it } from 'vitest'
import { compareLayouts } from './compare-layout.lib'

describe('compareLayouts', () => {
	it('finds nothing when every box is the same', () => {
		const record = {
			'/main[0]': [0, 0, 100, 50],
			'/main[0]/p[0]': [8, 8, 84, 20],
		}
		expect(compareLayouts(record, { ...record })).toEqual([])
	})

	it('reports a moved parent once, not each child that moves with it', () => {
		const before = {
			'/main[0]': [0, 0, 100, 50],
			'/main[0]/p[0]': [8, 8, 84, 20],
			'/main[0]/p[1]': [8, 30, 84, 20],
		}
		const after = {
			'/main[0]': [0, 16, 100, 50],
			'/main[0]/p[0]': [8, 24, 84, 20],
			'/main[0]/p[1]': [8, 46, 84, 20],
		}
		expect(compareLayouts(before, after)).toEqual([
			{ element: 'main[0]', delta: [0, 16, 0, 0] },
		])
	})

	it('matches an element inside a new wrapper by its own name', () => {
		const before = { '/main[0]/p.title[0]': [8, 8, 84, 20] }
		const after = { '/main[0]/div.stack[0]/p.title[0]': [8, 8, 84, 20] }
		expect(compareLayouts(before, after)).toEqual([])
	})

	it('ignores sub-pixel differences within the tolerance', () => {
		const before = { '/p[0]': [8, 8, 84, 20] }
		const after = { '/p[0]': [8.5, 8, 84, 20] }
		expect(compareLayouts(before, after)).toEqual([])
	})
})
