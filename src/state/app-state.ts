import type { Artist } from '../entities/artist'
import {
	OnboardingStep,
	type OnboardingStepValue,
} from '../entities/onboarding'

export interface GuestFollow {
	artist: Artist
	home: string | null
}

export interface OnboardingState {
	step: OnboardingStepValue
	spotlightTarget: string
	spotlightMessage: string
	spotlightRadius: string
	spotlightActive: boolean
}

export interface GuestState {
	follows: GuestFollow[]
	home: string | null
}

export interface AppState {
	onboarding: OnboardingState
	guest: GuestState
}

export const initialState: AppState = {
	onboarding: {
		step: OnboardingStep.LP,
		spotlightTarget: '',
		spotlightMessage: '',
		spotlightRadius: '12px',
		spotlightActive: false,
	},
	guest: {
		follows: [],
		home: null,
	},
}
