import { IRouter, type IRouteViewModel } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IConsentService } from '../../lib/consent/consent-service'
import { IOnboardingService } from '../../services/onboarding-service'

/**
 * Final onboarding step — surfaces per-purpose analytics consent before
 * the user is dropped onto the dashboard. The screen is the ONLY place
 * that calls `consent.grant/revoke/defer`; all three exits (accept /
 * decline / later) terminate by marking onboarding complete and routing
 * to `/dashboard`.
 *
 * The toggle fields (`analyticsConsent`, `marketingConsent`) are bound
 * two-way to the toggle rows in the template. They are seeded from the
 * live `ConsentService` getters in `attached()` so a revisit (e.g. via
 * deep link) shows the user's current state rather than a blank toggle.
 * Local writes are buffered in these fields and only flushed to
 * `ConsentService` when the user taps "Accept selected" — this is the
 * standard "draft then submit" pattern for consent UX, and it keeps the
 * IEventAggregator publish from firing on every toggle tap (the
 * AnalyticsService SDK reconfiguration is a real side effect).
 */
export class ConsentRoute implements IRouteViewModel {
	private readonly consent = resolve(IConsentService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ConsentRoute')

	public analyticsConsent = false
	public marketingConsent = false

	public attached(): void {
		// Hydrate from the live consent state so a returning user sees
		// their previous choice reflected on the toggles. First-run users
		// land here with both purposes false — the privacy-default
		// posture.
		this.analyticsConsent = this.consent.analytics
		this.marketingConsent = this.consent.marketingMeasurement
	}

	/** Persist the current toggle state to ConsentService and exit. */
	public async acceptSelected(): Promise<void> {
		this.applyPurpose('analytics', this.analyticsConsent)
		this.applyPurpose('marketingMeasurement', this.marketingConsent)
		this.logger.info('Consent accepted', {
			analytics: this.analyticsConsent,
			marketingMeasurement: this.marketingConsent,
		})
		await this.complete()
	}

	/** Revoke both purposes (fail-closed) and exit. */
	public async declineAll(): Promise<void> {
		this.consent.revoke('analytics')
		this.consent.revoke('marketingMeasurement')
		this.logger.info('Consent declined for all purposes')
		await this.complete()
	}

	/** Mark the screen as deferred (no purpose change) and exit. */
	public async setUpLater(): Promise<void> {
		this.consent.defer()
		this.logger.info('Consent decision deferred')
		await this.complete()
	}

	/**
	 * Toggle handler bound to the consent rows. Aurelia 2 RC1's
	 * `aria-checked.bind` updates the attribute reactively from a plain
	 * field, but the `click.trigger` is what flips the field — we expose
	 * a single handler so the template stays declarative.
	 */
	public toggleAnalytics(): void {
		this.analyticsConsent = !this.analyticsConsent
	}

	public toggleMarketing(): void {
		this.marketingConsent = !this.marketingConsent
	}

	// -- Internals --------------------------------------------------------

	private applyPurpose(
		purpose: 'analytics' | 'marketingMeasurement',
		grant: boolean,
	): void {
		if (grant) {
			this.consent.grant(purpose)
		} else {
			this.consent.revoke(purpose)
		}
	}

	private async complete(): Promise<void> {
		this.onboarding.complete()
		await this.router.load('/dashboard')
	}
}
