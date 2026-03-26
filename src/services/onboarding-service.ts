import { DI, ILogger, observable, resolve } from 'aurelia'
import { loadStep, saveStep } from '../adapter/storage/onboarding-storage'
import {
	isCompleted as isCompletedStep,
	isOnboarding as isOnboardingStep,
	OnboardingStep,
	type OnboardingStepValue,
} from '../entities/onboarding'

export {
	OnboardingStep,
	type OnboardingStepValue,
	STEP_ORDER,
	stepIndex,
} from '../entities/onboarding'

/**
 * Maps each onboarding step to the route the user should be on.
 */
export const STEP_ROUTE_MAP: Record<OnboardingStepValue, string> = {
	[OnboardingStep.LP]: '',
	[OnboardingStep.DISCOVERY]: 'discovery',
	[OnboardingStep.DASHBOARD]: 'dashboard',
	[OnboardingStep.MY_ARTISTS]: 'my-artists',
	[OnboardingStep.COMPLETED]: '',
}

export const IOnboardingService = DI.createInterface<IOnboardingService>(
	'IOnboardingService',
	(x) => x.singleton(OnboardingService),
)

export interface IOnboardingService extends OnboardingService {}

/** Minimum followed artists to unlock dashboard navigation. */
export const DASHBOARD_FOLLOW_TARGET = 5
/** Minimum artists with concerts to unlock dashboard navigation. */
export const DASHBOARD_CONCERT_TARGET = 3

/**
 * Singleton service owning all onboarding state.
 * Step is persisted to localStorage via @observable + stepChanged().
 * Spotlight properties are plain (no persistence needed).
 */
export class OnboardingService {
	private readonly logger = resolve(ILogger).scopeTo('OnboardingService')

	@observable public step: OnboardingStepValue = loadStep()

	// Spotlight — plain properties, auto-observed by Aurelia templates
	public spotlightTarget = ''
	public spotlightMessage = ''
	public spotlightRadius = '12px'
	public spotlightActive = false

	// Discovery counts — updated by DiscoveryRoute via setDiscoveryCounts()
	public followedCount = 0
	public artistsWithConcertsCount = 0

	// Callbacks — not state, cannot live in a store
	public onSpotlightTap: (() => void) | undefined = undefined
	public onBringToFront: (() => void) | undefined = undefined

	/**
	 * Persist step to localStorage on change.
	 */
	public stepChanged(newValue: OnboardingStepValue): void {
		saveStep(newValue)
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
		this.spotlightActive = true
		this.onSpotlightTap = onTap
	}

	/**
	 * Deactivate the spotlight entirely.
	 */
	public deactivateSpotlight(): void {
		this.spotlightTarget = ''
		this.spotlightMessage = ''
		this.spotlightRadius = '12px'
		this.spotlightActive = false
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
	 * Alias for step — preserves the public API used by routes and hooks.
	 */
	public get currentStep(): OnboardingStepValue {
		return this.step
	}

	/**
	 * Whether the user is currently in the onboarding flow.
	 */
	public get isOnboarding(): boolean {
		return isOnboardingStep(this.step)
	}

	/**
	 * Whether onboarding has been completed at least once.
	 */
	public get isCompleted(): boolean {
		return isCompletedStep(this.step)
	}

	/**
	 * Advance to the given step.
	 */
	public setStep(step: OnboardingStepValue): void {
		this.logger.info('Step transition', {
			from: this.step,
			to: step,
		})
		this.step = step
	}

	/**
	 * Mark onboarding as completed.
	 */
	public complete(): void {
		this.deactivateSpotlight()
		this.step = OnboardingStep.COMPLETED
	}

	/**
	 * Reset to LP. Used when starting a fresh onboarding.
	 */
	public reset(): void {
		this.step = OnboardingStep.LP
	}

	/**
	 * Get the route path for the current step.
	 */
	public getRouteForCurrentStep(): string {
		return STEP_ROUTE_MAP[this.step]
	}

	/**
	 * Update the discovery progress counts used by readyForDashboard.
	 * Called by DiscoveryRoute whenever follow or concert counts change.
	 * Call with (0, 0) in detaching() to reset on page leave.
	 */
	public setDiscoveryCounts(followed: number, concerts: number): void {
		this.followedCount = followed
		this.artistsWithConcertsCount = concerts
	}

	/**
	 * Whether the user has met the condition to navigate to the dashboard
	 * from the discovery step (without having tapped the coach mark).
	 */
	public get readyForDashboard(): boolean {
		return (
			this.step === OnboardingStep.DISCOVERY &&
			(this.followedCount >= DASHBOARD_FOLLOW_TARGET ||
				this.artistsWithConcertsCount >= DASHBOARD_CONCERT_TARGET)
		)
	}
}
