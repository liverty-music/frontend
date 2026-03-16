import type { IStore } from '@aurelia/state'
import { vi } from 'vitest'

interface GuestFollow {
	artistId: string
	name: string
}

interface OnboardingState {
	step: string
	spotlightTarget: string
	spotlightMessage: string
	spotlightRadius: string
	spotlightActive: boolean
}

interface GuestState {
	follows: GuestFollow[]
	home: string | null
}

interface MockAppState {
	onboarding: OnboardingState
	guest: GuestState
}

type MockAppAction = { type: string; [key: string]: unknown }

/**
 * Creates a mock IStore with a mutable state object.
 * Callers can mutate `state` directly and `getState()` will reflect changes.
 *
 * Types are inlined to avoid importing from source modules, which
 * would trigger vi.mock hoisting issues in test files.
 */
export function createMockStore(overrides: Partial<MockAppState> = {}): {
	store: IStore<MockAppState>
	state: MockAppState
} {
	const state: MockAppState = {
		onboarding: {
			step: 'lp',
			spotlightTarget: '',
			spotlightMessage: '',
			spotlightRadius: '12px',
			spotlightActive: false,
			...overrides.onboarding,
		},
		guest: {
			follows: [],
			home: null,
			...overrides.guest,
		},
	}

	const store = {
		getState: vi.fn(() => state),
		dispatch: vi.fn((action: MockAppAction) => {
			switch (action.type) {
				case 'onboarding/advance':
					state.onboarding.step = action.step as string
					break
				case 'onboarding/complete':
					state.onboarding.step = 'completed'
					break
				case 'onboarding/reset':
					state.onboarding.step = 'lp'
					break
				case 'onboarding/setSpotlight':
					state.onboarding.spotlightTarget = action.target as string
					state.onboarding.spotlightMessage = action.message as string
					state.onboarding.spotlightRadius = (action.radius as string) ?? '12px'
					state.onboarding.spotlightActive = true
					break
				case 'onboarding/clearSpotlight':
					state.onboarding.spotlightTarget = ''
					state.onboarding.spotlightMessage = ''
					state.onboarding.spotlightRadius = '12px'
					state.onboarding.spotlightActive = false
					break
				case 'guest/follow':
					state.guest.follows = [
						...state.guest.follows,
						{
							artistId: action.artistId as string,
							name: action.name as string,
						},
					]
					break
				case 'guest/unfollow':
					state.guest.follows = state.guest.follows.filter(
						(f) => f.artistId !== action.artistId,
					)
					break
				case 'guest/setUserHome':
					state.guest.home = action.code as string
					break
				case 'guest/clearAll':
					state.guest.follows = []
					state.guest.home = null
					break
			}
		}),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		registerMiddleware: vi.fn(),
		unregisterMiddleware: vi.fn(),
		registerAction: vi.fn(),
	} as unknown as IStore<MockAppState>

	return { store, state }
}
