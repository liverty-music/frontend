/**
 * Onboarding state is modeled as a single boolean (see `OnboardingService`).
 * The legacy step machine (`OnboardingStep` enum, `STEP_ORDER`, `stepIndex`,
 * `STEP_MIGRATION`, `normalizeStep`, step predicates) has been removed; this
 * module intentionally holds no step-machine symbols.
 *
 * The set of legacy `localStorage['onboardingStep']` values that denote a
 * completed first run. Used once at `OnboardingService` construction to migrate
 * the old key to the new `onboardingComplete` boolean. `'7'` is the legacy
 * numeric index that mapped to the old `COMPLETED` step.
 */
export const LEGACY_COMPLETED_STEPS: ReadonlySet<string> = new Set([
	'completed',
	'7',
])
