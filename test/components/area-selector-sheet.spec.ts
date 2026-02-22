import { DI, LoggerConfiguration, LogLevel } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaSelectorSheet } from '../../src/components/area-selector-sheet/area-selector-sheet'
import { REGION_STORAGE_KEY } from '../../src/components/region-setup-sheet/region-setup-sheet'

describe('AreaSelectorSheet', () => {
	let sut: AreaSelectorSheet

	beforeEach(() => {
		localStorage.clear()
		const container = DI.createContainer()
		container.register(LoggerConfiguration.create({ level: LogLevel.none }))
		container.register(AreaSelectorSheet)
		sut = container.get(AreaSelectorSheet)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	describe('open/close', () => {
		it('should open the sheet and reset selectedRegion', () => {
			sut.open()
			expect(sut.isOpen).toBe(true)
			expect(sut.selectedRegion).toBeNull()
		})

		it('should close the sheet and defer selectedRegion reset', () => {
			vi.useFakeTimers()
			sut.open()
			sut.selectRegion(sut.regions[0])
			sut.close()
			expect(sut.isOpen).toBe(false)
			expect(sut.selectedRegion).not.toBeNull()
			vi.advanceTimersByTime(300)
			expect(sut.selectedRegion).toBeNull()
			vi.useRealTimers()
		})

		it('should not reset selectedRegion if reopened before timer fires', () => {
			vi.useFakeTimers()
			sut.open()
			sut.selectRegion(sut.regions[2])
			sut.close()
			sut.open()
			sut.selectRegion(sut.regions[1])
			vi.advanceTimersByTime(300)
			expect(sut.selectedRegion).toBe(sut.regions[1])
			vi.useRealTimers()
		})
	})

	describe('region selection', () => {
		it('should set selectedRegion when a region is selected', () => {
			const kanto = sut.regions[2]
			sut.selectRegion(kanto)
			expect(sut.selectedRegion).toBe(kanto)
			expect(sut.selectedRegion?.name).toBe('関東')
		})

		it('should go back to regions list', () => {
			sut.selectRegion(sut.regions[0])
			sut.backToRegions()
			expect(sut.selectedRegion).toBeNull()
		})
	})

	describe('prefecture selection', () => {
		it('should save prefecture to localStorage and close', () => {
			sut.open()
			sut.selectPrefecture('東京')

			expect(localStorage.getItem(REGION_STORAGE_KEY)).toBe('東京')
			expect(sut.isOpen).toBe(false)
		})

		it('should invoke onAreaSelected callback', () => {
			const callback = vi.fn()
			sut.onAreaSelected = callback
			sut.selectPrefecture('大阪')

			expect(callback).toHaveBeenCalledWith({ $event: '大阪' })
		})
	})

	describe('getStoredArea', () => {
		it('should return null when no area is stored', () => {
			expect(AreaSelectorSheet.getStoredArea()).toBeNull()
		})

		it('should return stored area', () => {
			localStorage.setItem(REGION_STORAGE_KEY, '愛知')
			expect(AreaSelectorSheet.getStoredArea()).toBe('愛知')
		})
	})

	describe('regions data', () => {
		it('should have 8 regions', () => {
			expect(sut.regions).toHaveLength(8)
		})

		it('should cover all 47 prefectures', () => {
			const total = sut.regions.reduce(
				(sum, r) => sum + r.prefectures.length,
				0,
			)
			expect(total).toBe(47)
		})
	})
})
