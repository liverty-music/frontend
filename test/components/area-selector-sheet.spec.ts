import { I18N } from '@aurelia/i18n'
import { IStore } from '@aurelia/state'
import { DI, LoggerConfiguration, LogLevel, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserHomeSelector } from '../../src/components/user-home-selector/user-home-selector'
import { IAuthService } from '../../src/services/auth-service'
import { IUserService } from '../../src/services/user-service'
import { createMockI18n } from '../helpers/mock-i18n'
import {
	createMockAuthService,
	createMockUserService,
} from '../helpers/mock-rpc-clients'
import { createMockStore } from '../helpers/mock-store'

describe('UserHomeSelector', () => {
	let sut: UserHomeSelector
	let mockStoreInstance: ReturnType<typeof createMockStore>

	beforeEach(() => {
		localStorage.clear()
		mockStoreInstance = createMockStore()
		const container = DI.createContainer()
		container.register(LoggerConfiguration.create({ level: LogLevel.none }))
		container.register(Registration.instance(I18N, createMockI18n()))
		container.register(
			Registration.instance(IAuthService, createMockAuthService()),
		)
		container.register(
			Registration.instance(IUserService, createMockUserService()),
		)
		container.register(Registration.instance(IStore, mockStoreInstance.store))
		container.register(UserHomeSelector)
		sut = container.get(UserHomeSelector)
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

		it('should close the sheet and reset selectedRegion when bottom-sheet closes', () => {
			sut.open()
			sut.selectRegion(sut.regions[0])
			sut.onSheetClosed()
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
		it('should dispatch guest/setUserHome for guest and close', async () => {
			sut.open()
			await sut.selectPrefecture('JP-13')

			expect(mockStoreInstance.store.dispatch).toHaveBeenCalledWith({
				type: 'guest/setUserHome',
				code: 'JP-13',
			})
			expect(sut.isOpen).toBe(false)
		})

		it('should invoke onHomeSelected callback with ISO code', async () => {
			const callback = vi.fn()
			sut.onHomeSelected = callback
			await sut.selectPrefecture('JP-27')

			expect(callback).toHaveBeenCalledWith('JP-27')
		})
	})

	describe('quick city selection', () => {
		it('should dispatch guest/setUserHome for guest and close', async () => {
			sut.open()
			await sut.selectQuickCity('JP-13')

			expect(mockStoreInstance.store.dispatch).toHaveBeenCalledWith({
				type: 'guest/setUserHome',
				code: 'JP-13',
			})
			expect(sut.isOpen).toBe(false)
		})

		it('should invoke onHomeSelected callback with ISO code', async () => {
			const callback = vi.fn()
			sut.onHomeSelected = callback
			await sut.selectQuickCity('JP-27')

			expect(callback).toHaveBeenCalledWith('JP-27')
		})
	})

	describe('getStoredHome', () => {
		it('should return null when no home is stored', () => {
			expect(UserHomeSelector.getStoredHome()).toBeNull()
		})

		it('should return stored home', () => {
			localStorage.setItem('guest.home', 'JP-23')
			expect(UserHomeSelector.getStoredHome()).toBe('JP-23')
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
