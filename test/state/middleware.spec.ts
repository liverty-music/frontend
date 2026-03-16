import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingStep } from '../../src/services/onboarding-service'
import { type AppState, initialState } from '../../src/state/app-state'
import {
	createLoggingMiddleware,
	loadPersistedState,
	persistenceMiddleware,
} from '../../src/state/middleware'

describe('createLoggingMiddleware', () => {
	it('logs action type and returns state unchanged', () => {
		const logger = { info: vi.fn() } as unknown as import('aurelia').ILogger
		const middleware = createLoggingMiddleware(logger)
		const result = middleware(initialState, { type: 'guest/follow' })
		expect(logger.info).toHaveBeenCalledWith('[Store]', 'guest/follow')
		expect(result).toBe(initialState)
	})

	it('logs "unknown" when action has no type', () => {
		const logger = { info: vi.fn() } as unknown as import('aurelia').ILogger
		const middleware = createLoggingMiddleware(logger)
		middleware(initialState, {})
		expect(logger.info).toHaveBeenCalledWith('[Store]', 'unknown')
	})
})

describe('persistenceMiddleware', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('persists onboarding step', () => {
		const state: AppState = {
			...initialState,
			onboarding: {
				...initialState.onboarding,
				step: OnboardingStep.DASHBOARD,
			},
		}
		persistenceMiddleware(state, {})
		expect(localStorage.getItem('onboardingStep')).toBe('dashboard')
	})

	it('persists guest follows as JSON', () => {
		const state: AppState = {
			...initialState,
			guest: {
				follows: [{ artistId: 'a1', name: 'Artist 1' }],
				home: null,
			},
		}
		persistenceMiddleware(state, {})
		const stored = JSON.parse(
			localStorage.getItem('guest.followedArtists') ?? '[]',
		)
		expect(stored).toEqual([{ artistId: 'a1', name: 'Artist 1' }])
	})

	it('persists guest home', () => {
		const state: AppState = {
			...initialState,
			guest: { follows: [], home: 'JP-13' },
		}
		persistenceMiddleware(state, {})
		expect(localStorage.getItem('guest.home')).toBe('JP-13')
	})

	it('removes guest home from localStorage when null', () => {
		localStorage.setItem('guest.home', 'JP-13')
		persistenceMiddleware(initialState, {})
		expect(localStorage.getItem('guest.home')).toBeNull()
	})
})

describe('loadPersistedState', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('returns empty object when no persisted state', () => {
		const result = loadPersistedState()
		expect(result).toEqual({})
	})

	it('loads onboarding step', () => {
		localStorage.setItem('onboardingStep', 'dashboard')
		const result = loadPersistedState()
		expect(result.onboarding?.step).toBe(OnboardingStep.DASHBOARD)
	})

	it('resets invalid onboarding step to LP', () => {
		localStorage.setItem('onboardingStep', 'invalid-value')
		const result = loadPersistedState()
		expect(result.onboarding?.step).toBe(OnboardingStep.LP)
		expect(localStorage.getItem('onboardingStep')).toBe('lp')
	})

	it('loads guest followed artists', () => {
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([{ artistId: 'a1', name: 'Artist 1' }]),
		)
		const result = loadPersistedState()
		expect(result.guest?.follows).toEqual([
			{ artistId: 'a1', name: 'Artist 1' },
		])
	})

	it('loads guest home', () => {
		localStorage.setItem('guest.home', 'JP-13')
		const result = loadPersistedState()
		expect(result.guest?.home).toBe('JP-13')
	})

	it('handles invalid JSON in guest follows gracefully', () => {
		localStorage.setItem('guest.followedArtists', '{invalid}')
		const result = loadPersistedState()
		expect(result.guest?.follows).toEqual([])
	})
})
