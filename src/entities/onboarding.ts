/**
 * Onboarding step values as string literals for readability in code and localStorage.
 * @source Onboarding flow progression through the app.
 */
export const OnboardingStep = {
	LP: 'lp',
	DISCOVERY: 'discovery',
	DASHBOARD: 'dashboard',
	DETAIL: 'detail',
	MY_ARTISTS: 'my-artists',
	COMPLETED: 'completed',
} as const

export type OnboardingStepValue =
	(typeof OnboardingStep)[keyof typeof OnboardingStep]

/**
 * Ordered progression of onboarding steps for ordinal comparison.
 */
export const STEP_ORDER = [
	OnboardingStep.LP,
	OnboardingStep.DISCOVERY,
	OnboardingStep.DASHBOARD,
	OnboardingStep.DETAIL,
	OnboardingStep.MY_ARTISTS,
	OnboardingStep.COMPLETED,
] as const

/**
 * Returns the ordinal index of a step in the progression.
 */
export function stepIndex(step: OnboardingStepValue): number {
	return STEP_ORDER.indexOf(step)
}

/** Set of steps that constitute the active onboarding flow. */
const ONBOARDING_STEPS = new Set<OnboardingStepValue>([
	OnboardingStep.DISCOVERY,
	OnboardingStep.DASHBOARD,
	OnboardingStep.DETAIL,
	OnboardingStep.MY_ARTISTS,
])

/**
 * Whether a step is part of the active onboarding flow.
 */
export function isOnboarding(step: OnboardingStepValue): boolean {
	return ONBOARDING_STEPS.has(step)
}

/**
 * Whether a step represents completed onboarding.
 */
export function isCompleted(step: OnboardingStepValue): boolean {
	return step === OnboardingStep.COMPLETED
}

/** Legacy numeric step index → current string step mapping. */
const NUMERIC_STEP_MIGRATION: Record<string, OnboardingStepValue> = {
	'0': OnboardingStep.LP,
	'1': OnboardingStep.DISCOVERY,
	'3': OnboardingStep.DASHBOARD,
	'4': OnboardingStep.DETAIL,
	'5': OnboardingStep.MY_ARTISTS,
	'7': OnboardingStep.COMPLETED,
}

const VALID_STEPS = new Set<string>(STEP_ORDER)

/**
 * Normalize a raw step value (potentially a legacy numeric index) into a valid OnboardingStepValue.
 * Returns 'lp' as fallback for unrecognized values.
 */
export function normalizeStep(raw: string): OnboardingStepValue {
	if (VALID_STEPS.has(raw)) {
		return raw as OnboardingStepValue
	}
	if (raw in NUMERIC_STEP_MIGRATION) {
		return NUMERIC_STEP_MIGRATION[raw]
	}
	return OnboardingStep.LP
}
