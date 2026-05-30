import { DI, ILogger, resolve } from 'aurelia'

/**
 * Per-purpose consent state for product analytics and related cross-border
 * measurement. The shape mirrors the eventual persisted record so the Batch
 * 3b implementation can swap in the real storage-backed service without
 * changing this interface or any consumer (notably `AnalyticsService`).
 *
 * Field semantics:
 *   - `analytics`: covers PostHog event capture, identification with the
 *     real user id, and persistent storage (cookies / localStorage). When
 *     false, AnalyticsService MUST stay in memory-only / anonymous mode.
 *   - `marketingMeasurement`: covers cross-border data transfer to PostHog
 *     Cloud EU for funnel / retention dashboards. Separate from
 *     `analytics` because APPI Article 28 requires explicit, granular
 *     opt-in for cross-border transfer.
 */
export type ConsentState = {
	readonly analytics: boolean
	readonly marketingMeasurement: boolean
}

/**
 * Read-only consent state queried by AnalyticsService at every gating
 * decision point. Batch 3b extends this interface with mutators
 * (`grant(purpose)`, `revoke(purpose)`, persistence helpers, plus the
 * Aurelia `@observable` field that drives the consent screen UI) and
 * publishes a `consent:changed` IEventAggregator event without touching
 * the read shape exposed below, so AnalyticsService keeps working
 * unchanged across the 3a → 3b transition.
 *
 * The current Batch 3a stub ALWAYS reports consent denied. This is the
 * fail-closed default: until the user explicitly grants consent on the
 * Batch 3b screen, no PostHog identification and no persistent storage
 * may occur. Matches the "pre-consent SDK initialisation uses
 * persistence: 'memory'" requirement (tasks 6.4 / 6.5 of the
 * `introduce-analytics-tool` OpenSpec change).
 */
export interface IConsentService {
	/**
	 * `true` iff the user has granted consent for PostHog event capture,
	 * persistent client-side storage, and identification with the real
	 * user id. Polled by `AnalyticsService.identify` at every call.
	 */
	readonly analytics: boolean
	/**
	 * `true` iff the user has granted consent for cross-border transfer
	 * of analytics data to PostHog Cloud EU for marketing-measurement
	 * dashboards. APPI Article 28 requires this purpose to be granted
	 * independently from `analytics`.
	 */
	readonly marketingMeasurement: boolean
}

export const IConsentService = DI.createInterface<IConsentService>(
	'IConsentService',
	(x) => x.singleton(ConsentServiceStub),
)

/**
 * Batch 3a stub. Always reports consent denied so AnalyticsService's
 * consent-gated paths (identify, persistent storage) stay disabled
 * until the Batch 3b consent screen ships. The class name carries the
 * `Stub` suffix so a casual reader of `main.ts` notices the placeholder
 * and an IDE's go-to-implementation lands here rather than on the
 * eventual production implementation.
 *
 * Batch 3b will:
 *   - Add localStorage hydration in the constructor (read a versioned
 *     consent record).
 *   - Add `grant(purpose)` / `revoke(purpose)` mutators that persist the
 *     record and publish a `consent:changed` event on IEventAggregator
 *     so AnalyticsService can react (`posthog.set_config({ persistence:
 *     'localStorage+cookie' })` on grant, `posthog.reset()` on revoke).
 *   - Add the consent-screen UI under `src/routes/consent/`.
 *
 * Test-suite hook: the `@internal` `_setStateForTests` method lets
 * AnalyticsService specs cover the "consent granted later" code path
 * without depending on the unimplemented Batch 3b mutation API. It is
 * deliberately not part of `IConsentService` — production code MUST NOT
 * call it (and TypeScript will refuse, since DI hands callers the
 * interface type).
 */
export class ConsentServiceStub implements IConsentService {
	private readonly logger = resolve(ILogger).scopeTo('ConsentService')

	private _state: ConsentState = {
		analytics: false,
		marketingMeasurement: false,
	}

	public constructor() {
		this.logger.debug(
			'ConsentService stub active — analytics consent is denied until the Batch 3b consent screen ships',
		)
	}

	public get analytics(): boolean {
		return this._state.analytics
	}

	public get marketingMeasurement(): boolean {
		return this._state.marketingMeasurement
	}

	/**
	 * @internal Test-only mutator used by AnalyticsService specs to
	 *   exercise the "consent granted" branches. Removed when the real
	 *   ConsentService lands in Batch 3b (the spec suite will switch to
	 *   the production `grant(purpose)` API at that point).
	 */
	public _setStateForTests(next: ConsentState): void {
		this._state = next
	}
}
