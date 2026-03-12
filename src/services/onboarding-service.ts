import { DI, ILogger, resolve } from 'aurelia'
import { StorageKeys } from '../constants/storage-keys'

/**
 * Onboarding step values.
 * 0 = LP (not started), 1-6 = tutorial in progress, 7 = completed.
 */
export const OnboardingStep = {
	LP: 0,
	DISCOVER: 1,
	LOADING: 2,
	DASHBOARD: 3,
	DETAIL: 4,
	MY_ARTISTS: 5,
	SIGNUP: 6,
	COMPLETED: 7,
} as const

export type OnboardingStepValue =
	(typeof OnboardingStep)[keyof typeof OnboardingStep]

/**
 * Maps each tutorial step to the route the user should be on.
 */
export const STEP_ROUTE_MAP: Record<OnboardingStepValue, string> = {
	[OnboardingStep.LP]: '',
	[OnboardingStep.DISCOVER]: 'discover',
	[OnboardingStep.LOADING]: 'onboarding/loading',
	[OnboardingStep.DASHBOARD]: 'dashboard',
	[OnboardingStep.DETAIL]: 'dashboard',
	[OnboardingStep.MY_ARTISTS]: 'my-artists',
	[OnboardingStep.SIGNUP]: '',
	[OnboardingStep.COMPLETED]: '',
}

export const IOnboardingService = DI.createInterface<IOnboardingService>(
	'IOnboardingService',
	(x) => x.singleton(OnboardingService),
)

export interface IOnboardingService extends OnboardingService {}

export class OnboardingService {
	private readonly logger = resolve(ILogger).scopeTo('OnboardingService')

	public currentStep: OnboardingStepValue

	// Spotlight config — driven by page components, consumed by app-shell coach mark
	public spotlightTarget = ''
	public spotlightMessage = ''
	public spotlightRadius = '12px'
	public spotlightActive = false
	public onSpotlightTap: (() => void) | undefined = undefined

	constructor() {
		this.currentStep = this.readStep()
		this.logger.debug('Initialized', { step: this.currentStep })
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
		this.spotlightTarget = target
		this.spotlightMessage = message
		this.spotlightRadius = radius
		this.onSpotlightTap = onTap
		this.spotlightActive = true
	}

	/**
	 * Deactivate the spotlight entirely. Called at Step 6 (SignUp).
	 */
	public deactivateSpotlight(): void {
		this.spotlightActive = false
		this.spotlightTarget = ''
		this.spotlightMessage = ''
		this.onSpotlightTap = undefined
	}

	/**
	 * Whether the user is currently in the onboarding flow (step 1-6).
	 */
	public get isOnboarding(): boolean {
		return (
			this.currentStep >= OnboardingStep.DISCOVER &&
			this.currentStep <= OnboardingStep.SIGNUP
		)
	}

	/**
	 * Whether the tutorial has been completed at least once.
	 */
	public get isCompleted(): boolean {
		return this.currentStep === OnboardingStep.COMPLETED
	}

	/**
	 * Advance to the given step and persist to LocalStorage.
	 */
	public setStep(step: OnboardingStepValue): void {
		this.logger.info('Step transition', {
			from: this.currentStep,
			to: step,
		})
		this.currentStep = step
		this.writeStep(step)
	}

	/**
	 * Mark tutorial as completed.
	 */
	public complete(): void {
		this.setStep(OnboardingStep.COMPLETED)
	}

	/**
	 * Reset to LP (step 0). Used when starting a fresh tutorial.
	 */
	public reset(): void {
		this.setStep(OnboardingStep.LP)
	}

	/**
	 * Get the route path for the current step.
	 */
	public getRouteForCurrentStep(): string {
		return STEP_ROUTE_MAP[this.currentStep]
	}

	private readStep(): OnboardingStepValue {
		const raw = localStorage.getItem(StorageKeys.onboardingStep)
		if (raw === null) {
			return OnboardingStep.LP
		}
		const parsed = Number(raw)
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 7) {
			this.logger.warn('Invalid onboardingStep value, resetting to 0', {
				raw,
			})
			localStorage.setItem(StorageKeys.onboardingStep, '0')
			return OnboardingStep.LP
		}
		return parsed as OnboardingStepValue
	}

	private writeStep(step: OnboardingStepValue): void {
		localStorage.setItem(StorageKeys.onboardingStep, String(step))
	}
}
