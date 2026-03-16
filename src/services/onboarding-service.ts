import { DI, ILogger, resolve } from 'aurelia'
import { resolveStore } from '../state/store-interface'

/**
 * Onboarding step values as string literals for readability in code and localStorage.
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
 * Maps each onboarding step to the route the user should be on.
 */
export const STEP_ROUTE_MAP: Record<OnboardingStepValue, string> = {
	[OnboardingStep.LP]: '',
	[OnboardingStep.DISCOVERY]: 'discovery',
	[OnboardingStep.DASHBOARD]: 'dashboard',
	[OnboardingStep.DETAIL]: 'dashboard',
	[OnboardingStep.MY_ARTISTS]: 'my-artists',
	[OnboardingStep.COMPLETED]: '',
}

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

/**
 * Set of steps that constitute the active onboarding flow.
 */
const ONBOARDING_STEPS = new Set<OnboardingStepValue>([
	OnboardingStep.DISCOVERY,
	OnboardingStep.DASHBOARD,
	OnboardingStep.DETAIL,
	OnboardingStep.MY_ARTISTS,
])

export const IOnboardingService = DI.createInterface<IOnboardingService>(
	'IOnboardingService',
	(x) => x.singleton(OnboardingService),
)

export interface IOnboardingService extends OnboardingService {}

/**
 * Thin facade over the Store for onboarding state.
 * Delegates all state reads/writes to IStore<AppState, AppAction>.
 * Retains callback management (onSpotlightTap, onBringToFront) as instance properties
 * since callbacks cannot be stored in a Redux-like store.
 */
export class OnboardingService {
	private readonly logger = resolve(ILogger).scopeTo('OnboardingService')
	private readonly store = resolveStore()

	// Callbacks — not state, cannot live in the Store
	public onSpotlightTap: (() => void) | undefined = undefined
	public onBringToFront: (() => void) | undefined = undefined

	public get currentStep(): OnboardingStepValue {
		return this.store.getState().onboarding.step
	}

	public get spotlightTarget(): string {
		return this.store.getState().onboarding.spotlightTarget
	}

	public get spotlightMessage(): string {
		return this.store.getState().onboarding.spotlightMessage
	}

	public get spotlightRadius(): string {
		return this.store.getState().onboarding.spotlightRadius
	}

	public get spotlightActive(): boolean {
		return this.store.getState().onboarding.spotlightActive
	}

	/**
	 * Activate the spotlight on a target element.
	 * Called by page components to drive the app-shell coach mark.
	 */
	public activateSpotlight(
		target: string,
		message: string,
		onTap?: () => void,
		radius = '12px',
	): void {
		this.store.dispatch({
			type: 'onboarding/setSpotlight',
			target,
			message,
			radius,
		})
		this.onSpotlightTap = onTap
	}

	/**
	 * Deactivate the spotlight entirely.
	 */
	public deactivateSpotlight(): void {
		this.store.dispatch({ type: 'onboarding/clearSpotlight' })
		this.onSpotlightTap = undefined
	}

	/**
	 * Re-insert the spotlight popover at the top of the LIFO stack.
	 * Used when another popover has entered the top layer after the coach mark.
	 */
	public bringSpotlightToFront(): void {
		this.onBringToFront?.()
	}

	/**
	 * Whether the user is currently in the onboarding flow.
	 */
	public get isOnboarding(): boolean {
		return ONBOARDING_STEPS.has(this.currentStep)
	}

	/**
	 * Whether onboarding has been completed at least once.
	 */
	public get isCompleted(): boolean {
		return this.currentStep === OnboardingStep.COMPLETED
	}

	/**
	 * Advance to the given step and persist via Store dispatch.
	 */
	public setStep(step: OnboardingStepValue): void {
		this.logger.info('Step transition', {
			from: this.currentStep,
			to: step,
		})
		this.store.dispatch({ type: 'onboarding/advance', step })
	}

	/**
	 * Mark onboarding as completed.
	 */
	public complete(): void {
		this.store.dispatch({ type: 'onboarding/complete' })
	}

	/**
	 * Reset to LP. Used when starting a fresh onboarding.
	 */
	public reset(): void {
		this.store.dispatch({ type: 'onboarding/reset' })
	}

	/**
	 * Get the route path for the current step.
	 */
	public getRouteForCurrentStep(): string {
		return STEP_ROUTE_MAP[this.currentStep]
	}
}
