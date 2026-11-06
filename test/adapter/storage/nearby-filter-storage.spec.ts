import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	clearNearbyFilter,
	loadNearbyFilter,
	saveNearbyFilter,
} from '../../../src/adapter/storage/nearby-filter-storage'

const KEY = 'discovery.nearbyFilter'

beforeEach(() => localStorage.clear())
afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})

describe('nearby filter storage', () => {
	it('starts from the home area and no preset when nothing is kept', () => {
		expect(loadNearbyFilter()).toEqual({ areaCode: null, datePreset: null })
	})

	it('keeps an area and a preset for the next visit', () => {
		saveNearbyFilter({ areaCode: 'JP-27' })
		saveNearbyFilter({ datePreset: 'weekend' })

		expect(loadNearbyFilter()).toEqual({
			areaCode: 'JP-27',
			datePreset: 'weekend',
		})
	})

	it('keeps no preset after a custom range, and keeps the area', () => {
		saveNearbyFilter({ areaCode: 'JP-27', datePreset: 'weekend' })
		saveNearbyFilter({ datePreset: null })

		expect(loadNearbyFilter()).toEqual({ areaCode: 'JP-27', datePreset: null })
	})

	it('follows the home area again once the home area is chosen', () => {
		saveNearbyFilter({ areaCode: 'JP-27', datePreset: 'month' })
		saveNearbyFilter({ areaCode: null })

		expect(loadNearbyFilter()).toEqual({ areaCode: null, datePreset: 'month' })
	})

	it('reads a malformed value as the defaults', () => {
		localStorage.setItem(KEY, '{"areaCode":"Osaka","datePreset":"year"}')
		expect(loadNearbyFilter()).toEqual({ areaCode: null, datePreset: null })
		localStorage.setItem(KEY, 'not json')
		expect(loadNearbyFilter()).toEqual({ areaCode: null, datePreset: null })
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

		expect(() => saveNearbyFilter({ datePreset: 'weekend' })).not.toThrow()
		expect(loadNearbyFilter()).toEqual({ areaCode: null, datePreset: null })
		expect(() => clearNearbyFilter()).not.toThrow()
	})

	it('forgets the kept filter', () => {
		saveNearbyFilter({ areaCode: 'JP-27', datePreset: 'weekend' })
		clearNearbyFilter()
		expect(localStorage.getItem(KEY)).toBeNull()
	})
})
