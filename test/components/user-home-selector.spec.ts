import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

// UserHomeSelector is a pure selection UI after the passive-concert-discovery
// refactor: it injects no IUserStore / IAuthService and performs no persistence.
// Its sole output is the onHomeSelected(code) callback; callers own the save.
describe('UserHomeSelector', () => {
	let sut: UserHomeSelector
	let onHomeSelected: ReturnType<typeof vi.fn>

	beforeEach(() => {
		onHomeSelected = vi.fn()

		const container = createTestContainer()
		container.register(UserHomeSelector)
		sut = container.get(UserHomeSelector)
		sut.onHomeSelected = onHomeSelected
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	describe('open / close', () => {
		it('sets isOpen to true on open', () => {
			sut.open()
			expect(sut.isOpen).toBe(true)
		})

		it('resets state on close', () => {
			sut.open()
			sut.selectRegion(sut.regions[0])
			sut.onSheetClosed()

			expect(sut.isOpen).toBe(false)
			expect(sut.selectedRegion).toBeNull()
		})
	})

	describe('region selection', () => {
		it('sets selectedRegion', () => {
			const region = sut.regions[0]
			sut.selectRegion(region)
			expect(sut.selectedRegion).toBe(region)
		})

		it('backToRegions clears selection', () => {
			sut.selectRegion(sut.regions[0])
			sut.backToRegions()
			expect(sut.selectedRegion).toBeNull()
		})
	})

	describe('confirmSelection', () => {
		it('emits onHomeSelected with the prefecture code and closes', () => {
			sut.open()
			sut.selectPrefecture('JP-13')

			expect(onHomeSelected).toHaveBeenCalledWith('JP-13')
			expect(sut.isOpen).toBe(false)
			expect(sut.selectedRegion).toBeNull()
		})

		it('does not write to localStorage (caller owns persistence)', () => {
			sut.selectPrefecture('JP-13')
			expect(localStorage.getItem('guest.home')).toBeNull()
		})
	})

	describe('quickCity selection', () => {
		it('confirms selection via quick city', () => {
			sut.selectQuickCity('JP-13')

			expect(onHomeSelected).toHaveBeenCalledWith('JP-13')
			expect(sut.isOpen).toBe(false)
		})
	})

	describe('currentCode highlight', () => {
		it('accepts a currentCode bindable used to highlight the active option', () => {
			sut.currentCode = 'JP-27'
			expect(sut.currentCode).toBe('JP-27')
		})
	})

	describe('getStoredHome', () => {
		it('returns null when no home stored', () => {
			expect(UserHomeSelector.getStoredHome()).toBeNull()
		})

		it('returns stored home', () => {
			localStorage.setItem('guest.home', 'JP-27')
			expect(UserHomeSelector.getStoredHome()).toBe('JP-27')
		})
	})
})
