import { describe, expect, it } from 'vitest'
import { Artist } from '../../src/entities/artist'
import { OnboardingStep } from '../../src/services/onboarding-service'
import type { AppAction } from '../../src/state/actions'
import { type AppState, initialState } from '../../src/state/app-state'
import { appReducer } from '../../src/state/reducer'

function stateWith(overrides: Partial<AppState> = {}): AppState {
	return { ...initialState, ...overrides }
}

describe('appReducer', () => {
	describe('onboarding actions', () => {
		it('advances step', () => {
			const result = appReducer(initialState, {
				type: 'onboarding/advance',
				step: OnboardingStep.DISCOVERY,
			})
			expect(result.onboarding.step).toBe(OnboardingStep.DISCOVERY)
			expect(result).not.toBe(initialState)
		})

		it('sets spotlight with defaults', () => {
			const result = appReducer(initialState, {
				type: 'onboarding/setSpotlight',
				target: '[data-nav="home"]',
				message: 'Tap here',
			})
			expect(result.onboarding.spotlightTarget).toBe('[data-nav="home"]')
			expect(result.onboarding.spotlightMessage).toBe('Tap here')
			expect(result.onboarding.spotlightRadius).toBe('12px')
			expect(result.onboarding.spotlightActive).toBe(true)
		})

		it('sets spotlight with custom radius', () => {
			const result = appReducer(initialState, {
				type: 'onboarding/setSpotlight',
				target: '[data-nav="home"]',
				message: 'Tap here',
				radius: '50%',
			})
			expect(result.onboarding.spotlightRadius).toBe('50%')
		})

		it('clears spotlight and resets radius', () => {
			const state = stateWith({
				onboarding: {
					...initialState.onboarding,
					spotlightTarget: '[data-nav="home"]',
					spotlightMessage: 'Tap here',
					spotlightRadius: '50%',
					spotlightActive: true,
				},
			})
			const result = appReducer(state, { type: 'onboarding/clearSpotlight' })
			expect(result.onboarding.spotlightTarget).toBe('')
			expect(result.onboarding.spotlightMessage).toBe('')
			expect(result.onboarding.spotlightRadius).toBe('12px')
			expect(result.onboarding.spotlightActive).toBe(false)
		})

		it('completes onboarding and clears spotlight', () => {
			const state = stateWith({
				onboarding: {
					...initialState.onboarding,
					step: OnboardingStep.MY_ARTISTS,
					spotlightActive: true,
					spotlightTarget: 'some-target',
					spotlightMessage: 'some-message',
					spotlightRadius: '50%',
				},
			})
			const result = appReducer(state, { type: 'onboarding/complete' })
			expect(result.onboarding.step).toBe(OnboardingStep.COMPLETED)
			expect(result.onboarding.spotlightActive).toBe(false)
			expect(result.onboarding.spotlightTarget).toBe('')
			expect(result.onboarding.spotlightRadius).toBe('12px')
		})

		it('resets onboarding to initial values', () => {
			const state = stateWith({
				onboarding: {
					step: OnboardingStep.DASHBOARD,
					spotlightTarget: 'target',
					spotlightMessage: 'msg',
					spotlightRadius: '50%',
					spotlightActive: true,
				},
			})
			const result = appReducer(state, { type: 'onboarding/reset' })
			expect(result.onboarding).toEqual(initialState.onboarding)
		})
	})

	describe('guest artist actions', () => {
		it('follows an artist', () => {
			const artist = new Artist({
				id: { value: 'a1' },
				name: { value: 'Artist 1' },
			})
			const result = appReducer(initialState, {
				type: 'guest/follow',
				artist,
			})
			expect(result.guest.follows).toEqual([
				{
					artist: expect.objectContaining({
						id: expect.objectContaining({ value: 'a1' }),
						name: expect.objectContaining({ value: 'Artist 1' }),
					}),
					home: null,
				},
			])
		})

		it('does not add duplicate follows', () => {
			const artist = new Artist({
				id: { value: 'a1' },
				name: { value: 'Artist 1' },
			})
			const state = stateWith({
				guest: {
					follows: [{ artist, home: null }],
					home: null,
				},
			})
			const result = appReducer(state, {
				type: 'guest/follow',
				artist,
			})
			expect(result).toBe(state)
		})

		it('unfollows an artist', () => {
			const artist1 = new Artist({
				id: { value: 'a1' },
				name: { value: 'Artist 1' },
			})
			const artist2 = new Artist({
				id: { value: 'a2' },
				name: { value: 'Artist 2' },
			})
			const state = stateWith({
				guest: {
					follows: [
						{ artist: artist1, home: null },
						{ artist: artist2, home: null },
					],
					home: null,
				},
			})
			const result = appReducer(state, {
				type: 'guest/unfollow',
				artistId: 'a1',
			})
			expect(result.guest.follows).toEqual([
				{
					artist: expect.objectContaining({
						id: expect.objectContaining({ value: 'a2' }),
						name: expect.objectContaining({ value: 'Artist 2' }),
					}),
					home: null,
				},
			])
		})

		it('sets user home', () => {
			const result = appReducer(initialState, {
				type: 'guest/setUserHome',
				code: 'JP-13',
			})
			expect(result.guest.home).toBe('JP-13')
		})

		it('clears all guest data', () => {
			const artist = new Artist({
				id: { value: 'a1' },
				name: { value: 'Artist 1' },
			})
			const state = stateWith({
				guest: {
					follows: [{ artist, home: null }],
					home: 'JP-13',
				},
			})
			const result = appReducer(state, { type: 'guest/clearAll' })
			expect(result.guest.follows).toEqual([])
			expect(result.guest.home).toBeNull()
		})
	})

	describe('onboarding edge cases', () => {
		it('advance to same step returns new state object', () => {
			const state = stateWith({
				onboarding: {
					...initialState.onboarding,
					step: OnboardingStep.DASHBOARD,
				},
			})
			const result = appReducer(state, {
				type: 'onboarding/advance',
				step: OnboardingStep.DASHBOARD,
			})
			expect(result.onboarding.step).toBe(OnboardingStep.DASHBOARD)
			expect(result).not.toBe(state)
		})

		it('preserves spotlight state across advance', () => {
			const state = stateWith({
				onboarding: {
					step: OnboardingStep.DASHBOARD,
					spotlightTarget: '[data-nav="home"]',
					spotlightMessage: 'Tap here',
					spotlightRadius: '50%',
					spotlightActive: true,
				},
			})
			const result = appReducer(state, {
				type: 'onboarding/advance',
				step: OnboardingStep.DETAIL,
			})
			expect(result.onboarding.step).toBe(OnboardingStep.DETAIL)
			expect(result.onboarding.spotlightTarget).toBe('[data-nav="home"]')
			expect(result.onboarding.spotlightMessage).toBe('Tap here')
			expect(result.onboarding.spotlightRadius).toBe('50%')
			expect(result.onboarding.spotlightActive).toBe(true)
		})

		it('completes from LP (non-onboarding state)', () => {
			const result = appReducer(initialState, { type: 'onboarding/complete' })
			expect(result.onboarding.step).toBe(OnboardingStep.COMPLETED)
			expect(result.onboarding.spotlightActive).toBe(false)
		})
	})

	describe('guest edge cases', () => {
		it('unfollow non-existent artist returns new state with same follows', () => {
			const artist = new Artist({
				id: { value: 'a1' },
				name: { value: 'Artist 1' },
			})
			const state = stateWith({
				guest: {
					follows: [{ artist, home: null }],
					home: null,
				},
			})
			const result = appReducer(state, {
				type: 'guest/unfollow',
				artistId: 'nonexistent',
			})
			expect(result.guest.follows).toEqual([
				{
					artist: expect.objectContaining({
						id: expect.objectContaining({ value: 'a1' }),
						name: expect.objectContaining({ value: 'Artist 1' }),
					}),
					home: null,
				},
			])
		})

		it('setUserHome overwrites existing home', () => {
			const state = stateWith({
				guest: { follows: [], home: 'JP-13' },
			})
			const result = appReducer(state, {
				type: 'guest/setUserHome',
				code: 'JP-27',
			})
			expect(result.guest.home).toBe('JP-27')
		})

		it('clearAll on already-empty state returns initial guest', () => {
			const result = appReducer(initialState, { type: 'guest/clearAll' })
			expect(result.guest.follows).toEqual([])
			expect(result.guest.home).toBeNull()
		})
	})

	it('returns state unchanged for unknown action', () => {
		const result = appReducer(initialState, {
			type: 'unknown/action',
		} as unknown as AppAction)
		expect(result).toBe(initialState)
	})

	it('does not mutate original state', () => {
		const original = { ...initialState }
		const artist = new Artist({
			id: { value: 'a1' },
			name: { value: 'Artist 1' },
		})
		appReducer(initialState, {
			type: 'guest/follow',
			artist,
		})
		expect(initialState).toEqual(original)
	})
})
