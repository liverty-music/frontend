import { DI, LoggerConfiguration, LogLevel, Registration } from 'aurelia'
import { I18N } from '@aurelia/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaSelectorSheet } from '../../src/components/area-selector-sheet/area-selector-sheet'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createMockI18n } from '../helpers/mock-i18n'

describe('AreaSelectorSheet', () => {
	let sut: AreaSelectorSheet

	beforeEach(() => {
		localStorage.clear()
		const container = DI.createContainer()
		container.register(LoggerConfiguration.create({ level: LogLevel.none }))
		container.register(Registration.instance(I18N, createMockI18n()))
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

		it('should close the sheet and reset selectedRegion immediately', () => {
			sut.open()
			sut.selectRegion(sut.regions[0])
			sut.close()
			expect(sut.isOpen).toBe(false)
			expect(sut.selectedRegion).toBeNull()
		})
	})

	describe('region selection', () => {
		it('should set selectedRegion when a region is selected', () => {
			const kanto = sut.regions[2]
			sut.selectRegion(kanto)
			expect(sut.selectedRegion).toBe(kanto)
			expect(sut.selectedRegion?.key).toBe('kanto')
		})

		it('should go back to regions list', () => {
			sut.selectRegion(sut.regions[0])
			sut.backToRegions()
			expect(sut.selectedRegion).toBeNull()
		})
	})

	describe('prefecture selection', () => {
		it('should save prefecture key to localStorage and close', () => {
			sut.open()
			sut.selectPrefecture('tokyo')

			expect(localStorage.getItem(StorageKeys.userAdminArea)).toBe('tokyo')
			expect(sut.isOpen).toBe(false)
		})

		it('should invoke onAreaSelected callback with prefecture key', () => {
			const callback = vi.fn()
			sut.onAreaSelected = callback
			sut.selectPrefecture('osaka')

			expect(callback).toHaveBeenCalledWith('osaka')
		})
	})

	describe('getStoredArea', () => {
		it('should return null when no area is stored', () => {
			expect(AreaSelectorSheet.getStoredArea()).toBeNull()
		})

		it('should return stored area', () => {
			localStorage.setItem(StorageKeys.userAdminArea, 'aichi')
			expect(AreaSelectorSheet.getStoredArea()).toBe('aichi')
		})
	})

	describe('regions data', () => {
		it('should have 8 regions', () => {
			expect(sut.regions).toHaveLength(8)
		})

		it('should cover all 47 prefectures', () => {
			const total = sut.regions.reduce(
				(sum, r) => sum + r.prefectureKeys.length,
				0,
			)
			expect(total).toBe(47)
		})
	})
})
