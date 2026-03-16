import type { OnboardingStepValue } from '../services/onboarding-service'

export type AppAction =
	| { type: 'onboarding/advance'; step: OnboardingStepValue }
	| {
			type: 'onboarding/setSpotlight'
			target: string
			message: string
			radius?: string
	  }
	| { type: 'onboarding/clearSpotlight' }
	| { type: 'onboarding/complete' }
	| { type: 'onboarding/reset' }
	| { type: 'guest/follow'; artistId: string; name: string }
	| { type: 'guest/unfollow'; artistId: string }
	| { type: 'guest/setUserHome'; code: string }
	| { type: 'guest/clearAll' }
