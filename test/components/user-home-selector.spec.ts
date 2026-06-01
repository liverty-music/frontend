import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIUserStore = DI.createInterface('IUserStore')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
}))

const { UserHomeSelector } = await import(
	'../../src/components/user-home-selector/user-home-selector'
)

describe('UserHomeSelector', () => {
	let sut: UserHomeSelector
	let mockAuth: { isAuthenticated: boolean }
	let mockUserStore: {
		setGuestHome: ReturnType<typeof vi.fn>
		updateHome: ReturnType<typeof vi.fn>
	}
	// Alias to the merged store so the existing `mockUser.updateHome`
	// assertions read naturally against the one IUserStore the selector injects.
	let mockUser: typeof mockUserStore
	let onHomeSelected: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockAuth = { isAuthenticated: false }
		mockUserStore = {
			setGuestHome: vi.fn(),
			updateHome: vi.fn().mockResolvedValue(undefined),
		}
		mockUser = mockUserStore
		onHomeSelected = vi.fn()

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIUserStore, mockUserStore),
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
		it('calls userStore.setGuestHome for unauthenticated user', async () => {
			await sut.selectPrefecture('JP-13')

			expect(mockUserStore.setGuestHome).toHaveBeenCalledWith('JP-13')
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
