import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIGuestService = DI.createInterface('IGuestService')
const mockIUserService = DI.createInterface('IUserService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/guest-service', () => ({
	IGuestService: mockIGuestService,
}))
vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
}))

const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

describe('UserHomeSelector', () => {
	let sut: UserHomeSelector
	let mockAuth: { isAuthenticated: boolean }
	let mockGuest: { setHome: ReturnType<typeof vi.fn> }
	let mockUser: { updateHome: ReturnType<typeof vi.fn> }
	let onHomeSelected: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockAuth = { isAuthenticated: false }
		mockGuest = { setHome: vi.fn() }
		mockUser = { updateHome: vi.fn().mockResolvedValue(undefined) }
		onHomeSelected = vi.fn()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIGuestService, mockGuest),
			Registration.instance(mockIUserService, mockUser),
		)
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

	describe('confirmSelection (guest)', () => {
		it('calls guest.setHome for unauthenticated user', async () => {
			await sut.selectPrefecture('JP-13')

			expect(mockGuest.setHome).toHaveBeenCalledWith('JP-13')
			expect(onHomeSelected).toHaveBeenCalledWith('JP-13')
			expect(sut.isOpen).toBe(false)
		})

		it('does not call userService for guest', async () => {
			await sut.selectPrefecture('JP-13')
			expect(mockUser.updateHome).not.toHaveBeenCalled()
		})
	})

	describe('confirmSelection (authenticated)', () => {
		it('calls userService.updateHome for authenticated user', async () => {
			mockAuth.isAuthenticated = true

			await sut.selectPrefecture('JP-13')

			expect(mockUser.updateHome).toHaveBeenCalled()
			expect(onHomeSelected).toHaveBeenCalledWith('JP-13')
		})
	})

	describe('quickCity selection', () => {
		it('confirms selection via quick city', async () => {
			await sut.selectQuickCity('JP-13')

			expect(onHomeSelected).toHaveBeenCalledWith('JP-13')
			expect(sut.isOpen).toBe(false)
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
