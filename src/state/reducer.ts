import { OnboardingStep } from '../services/onboarding-service'
import type { AppAction } from './actions'
import { type AppState, initialState } from './app-state'

export function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		case 'onboarding/advance':
			return {
				...state,
				onboarding: { ...state.onboarding, step: action.step },
			}

		case 'onboarding/setSpotlight':
			return {
				...state,
				onboarding: {
					...state.onboarding,
					spotlightTarget: action.target,
					spotlightMessage: action.message,
					spotlightRadius: action.radius ?? '12px',
					spotlightActive: true,
				},
			}

		case 'onboarding/clearSpotlight':
			return {
				...state,
				onboarding: {
					...state.onboarding,
					spotlightTarget: '',
					spotlightMessage: '',
					spotlightRadius: '12px',
					spotlightActive: false,
				},
			}

		case 'onboarding/complete':
			return {
				...state,
				onboarding: {
					...state.onboarding,
					step: OnboardingStep.COMPLETED,
					spotlightTarget: '',
					spotlightMessage: '',
					spotlightRadius: '12px',
					spotlightActive: false,
				},
			}

		case 'onboarding/reset':
			return {
				...state,
				onboarding: { ...initialState.onboarding },
			}

		case 'guest/follow': {
			const artistId = action.artist.id
			if (state.guest.follows.some((f) => f.artist.id === artistId)) {
				return state
			}
			return {
				...state,
				guest: {
					...state.guest,
					follows: [
						...state.guest.follows,
						{ artist: action.artist, home: null },
					],
				},
			}
		}

		case 'guest/unfollow':
			return {
				...state,
				guest: {
					...state.guest,
					follows: state.guest.follows.filter(
						(f) => f.artist.id !== action.artistId,
					),
				},
			}

		case 'guest/setUserHome':
			return {
				...state,
				guest: {
					...state.guest,
					home: action.code,
				},
			}

		case 'guest/clearAll':
			return {
				...state,
				guest: { ...initialState.guest },
			}

		default:
			return state
	}
}
