import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	loadOnboardingComplete,
	saveOnboardingComplete,
} from '../adapter/storage/onboarding-storage'

export const IOnboardingService = DI.createInterface<IOnboardingService>(
	'IOnboardingService',
	(x) => x.singleton(OnboardingService),
)

export interface IOnboardingService extends OnboardingService {}

/**
 * Singleton service owning the single onboarding flag.
 *
 * Onboarding is modeled as one persisted, latched boolean rather than an ordered
 * step machine. The backing `onboardingComplete` field is `@observable` so the
 * derived `isOnboarding` / `isCompleted` getters notify dependent bindings and
 * watchers (`pwa-install-service` `@watch(isCompleted)`, the `app-shell.html`
 * `if.bind`, dashboard/my-artists `isOnboarding` template bindings). The legacy
 * `onboardingStep` key is migrated once on construction (see onboarding-storage).
 */
export class OnboardingService {
	private readonly logger = resolve(ILogger).scopeTo('OnboardingService')

	@observable public onboardingComplete: boolean = loadOnboardingComplete()

	/** Persist the flag to localStorage on change. */
	public onboardingCompleteChanged(newValue: boolean): void {
		saveOnboardingComplete(newValue)
	}

	/** Whether the user is currently in the first-run onboarding flow. */
	public get isOnboarding(): boolean {
		return !this.onboardingComplete
	}

	/** Whether onboarding has been completed (retained for call-site compatibility). */
	public get isCompleted(): boolean {
		return !this.isOnboarding
	}

	/**
	 * One-way completion latch. Once onboarding is finished it never returns to
	 * the onboarding state except via an explicit fresh-onboarding reset.
	 * Idempotent — a second call is a no-op.
	 */
	public finish(): void {
		if (this.onboardingComplete) return
		this.logger.info('Onboarding finished')
		this.onboardingComplete = true
	}
}
