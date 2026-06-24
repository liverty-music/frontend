import { IRouter, type IRouteViewModel } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'

/**
 * One-time, NON-BLOCKING analytics transparency notice. Under the
 * EU-adequacy opt-out model there is no consent gate: analytics is enabled
 * by default and the user opts out from settings at any time. This screen
 * exists solely to satisfy the 利用目的の通知・公表 (notification/publication
 * of the purpose of use) obligation — it names PostHog (Klant Solutions
 * B.V., Netherlands) and the cross-border purpose, links to the privacy
 * policy and to the settings opt-out, and offers a single acknowledge
 * action.
 *
 * Acknowledging NEVER changes the default-on opt-out state and NEVER gates
 * onboarding progression: the route is a standalone public page
 * (`data: { auth: false }`) reached by an explicit link, not a step in the
 * onboarding flow. The dismiss action simply records that the notice was
 * seen (so it is not re-surfaced) and navigates to the dashboard.
 */
const NOTICE_SEEN_KEY = 'liverty:analytics:noticeSeen'

export class ConsentRoute implements IRouteViewModel {
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ConsentRoute')

	/**
	 * Acknowledge the notice. Records the seen flag (best-effort) and exits
	 * to the dashboard. Deliberately does NOT touch ConsentService — the
	 * default-on opt-out posture is unchanged by acknowledging the notice.
	 */
	public async acknowledge(): Promise<void> {
		try {
			localStorage.setItem(NOTICE_SEEN_KEY, '1')
		} catch {
			// Private-mode / sandboxed storage failure is non-fatal: the
			// notice is informational and may simply re-surface next visit.
		}
		this.logger.info('Analytics transparency notice acknowledged')
		await this.router.load('/dashboard')
	}

	/** Navigate to the settings page where the opt-out toggles live. */
	public async openSettings(): Promise<void> {
		await this.router.load('/settings')
	}
}
