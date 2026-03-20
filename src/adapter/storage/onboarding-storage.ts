import {
	normalizeStep,
	type OnboardingStepValue,
} from '../../entities/onboarding'

const KEY_STEP = 'onboardingStep'

export function saveStep(step: OnboardingStepValue): void {
	localStorage.setItem(KEY_STEP, step)
}

export function loadStep(): OnboardingStepValue {
	const raw = localStorage.getItem(KEY_STEP)
	if (raw === null) return 'lp'
	const step = normalizeStep(raw)
	if (step !== raw) {
		localStorage.setItem(KEY_STEP, step)
	}
	return step
}
