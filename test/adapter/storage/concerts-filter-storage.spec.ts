import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearConcertsFilter,
	loadConcertsFilter,
	saveConcertsFilter,
} from '../../../src/adapter/storage/concerts-filter-storage'

const KEY = 'discovery.concertsFilter'

beforeEach(() => localStorage.clear())
afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe('nearby filter storage', () => {
	it('starts from the home area and no preset when nothing is kept', () => {
		expect(loadConcertsFilter()).toEqual({ areaCode: null, datePreset: null })
	})

	it('keeps an area and a preset for the next visit', () => {
		saveConcertsFilter({ areaCode: 'JP-27' })
		saveConcertsFilter({ datePreset: 'weekend' })

		expect(loadConcertsFilter()).toEqual({
			areaCode: 'JP-27',
			datePreset: 'weekend',
		})
	})

	it('keeps no preset after a custom range, and keeps the area', () => {
		saveConcertsFilter({ areaCode: 'JP-27', datePreset: 'weekend' })
		saveConcertsFilter({ datePreset: null })

		expect(loadConcertsFilter()).toEqual({
			areaCode: 'JP-27',
			datePreset: null,
		})
	})

	it('follows the home area again once the home area is chosen', () => {
		saveConcertsFilter({ areaCode: 'JP-27', datePreset: 'month' })
		saveConcertsFilter({ areaCode: null })

		expect(loadConcertsFilter()).toEqual({
			areaCode: null,
			datePreset: 'month',
		})
	})

	it('reads a malformed value as the defaults', () => {
		localStorage.setItem(KEY, '{"areaCode":"Osaka","datePreset":"year"}')
		expect(loadConcertsFilter()).toEqual({ areaCode: null, datePreset: null })
		localStorage.setItem(KEY, 'not json')
		expect(loadConcertsFilter()).toEqual({ areaCode: null, datePreset: null })
	})

	it('keeps nothing, and fails nothing, when storage is unavailable', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})

		expect(() => saveConcertsFilter({ datePreset: 'weekend' })).not.toThrow()
		expect(loadConcertsFilter()).toEqual({ areaCode: null, datePreset: null })
		expect(() => clearConcertsFilter()).not.toThrow()
	})

	it('forgets the kept filter', () => {
		saveConcertsFilter({ areaCode: 'JP-27', datePreset: 'weekend' })
		clearConcertsFilter()
		expect(localStorage.getItem(KEY)).toBeNull()
	})
})
