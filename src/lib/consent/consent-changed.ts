/**
 * Published whenever the per-purpose opt-out state changes (initial
 * hydration excluded). Subscribers react by updating their SDK posture —
 * AnalyticsService swaps PostHog capture/identification/recording mode on
 * every opt-in/opt-out so the SDK stays aligned with the user's latest
 * choice without the route VMs needing to know how each SDK is configured.
 *
 * Published via `IEventAggregator.publish(new ConsentChanged(state))` from
 * the `ConsentService` mutators (`grant`, `revoke`). The hydration code
 * path (constructor reading localStorage) MUST NOT publish — only true
 * state transitions trigger downstream side effects. This keeps boot-time
 * behaviour deterministic: AnalyticsService's `init()` already reads the
 * opt-out state directly, and replaying that read as an event would
 * double-fire the persistence config on every page load.
 */

import type { ConsentState } from './consent-service'

export class ConsentChanged {
	constructor(public readonly state: ConsentState) {}
}
