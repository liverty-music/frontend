import {
	normalizeStep,
	type OnboardingStepValue,
} from '../../entities/onboarding'

const KEY_STEP = 'onboardingStep'
const HELP_SEEN_PREFIX = 'liverty:onboarding:helpSeen:'

export function saveStep(step: OnboardingStepValue): void {
	localStorage.setItem(KEY_STEP, step)
}

export function saveHelpSeen(page: string): void {
	localStorage.setItem(HELP_SEEN_PREFIX + page, '1')
}

export function loadHelpSeen(page: string): boolean {
	return localStorage.getItem(HELP_SEEN_PREFIX + page) !== null
}

export function clearAllHelpSeen(): void {
	for (const page of ['discovery', 'dashboard', 'my-artists']) {
		localStorage.removeItem(HELP_SEEN_PREFIX + page)
	}
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
