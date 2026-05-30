import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import {
	loadConsentDeferred,
	loadConsentState,
	saveConsentDeferred,
	saveConsentState,
} from '../../adapter/storage/consent-storage'
import { ConsentChanged } from './consent-changed'

/**
 * Per-purpose consent state for product analytics and related cross-border
 * measurement. Surfaced read-only via `IConsentService`; the shape mirrors
 * the persisted record so downstream consumers (notably `AnalyticsService`)
 * never see anything richer than the user actually decided.
 *
 * Field semantics:
 *   - `analytics`: covers PostHog event capture, identification with the
 *     real user id, and persistent storage (cookies / localStorage). When
 *     false, AnalyticsService stays in memory-only / anonymous mode.
 *   - `marketingMeasurement`: covers cross-border data transfer to PostHog
 *     Cloud EU for funnel / retention dashboards. Separate from
 *     `analytics` because APPI Article 28 requires explicit, granular
 *     opt-in for cross-border transfer.
 */
export type ConsentState = {
	readonly analytics: boolean
	readonly marketingMeasurement: boolean
}

/** Consent purpose name; mirrors the keys of `ConsentState`. */
export type ConsentPurpose = 'analytics' | 'marketingMeasurement'

/**
 * Read + mutate surface for per-purpose consent. Read getters
 * (`analytics`, `marketingMeasurement`) preserve the Batch 3a contract so
 * `AnalyticsService` and any other consumer continue to work unchanged.
 * Mutators (`grant`, `revoke`, `defer`) and the `hasDecided()` predicate
 * are the Batch 3b additions consumed by the consent screen and settings
 * page.
 *
 * Every mutator MUST write back to localStorage AND publish a
 * `ConsentChanged` event on `IEventAggregator` so subscribers (currently
 * just `AnalyticsService`) can update their SDK posture synchronously
 * with the user's choice.
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

	/** Grant a single purpose; persists + publishes `ConsentChanged`. */
	grant(purpose: ConsentPurpose): void
	/** Revoke a single purpose; persists + publishes `ConsentChanged`. */
	revoke(purpose: ConsentPurpose): void
	/**
	 * Record that the consent screen was shown but the user chose to
	 * defer the decision. No purpose state changes; `hasDecided()` flips
	 * to `true` so onboarding can advance past the consent step without
	 * surfacing it again on the next boot.
	 */
	defer(): void
	/**
	 * `true` iff the user has explicitly granted/revoked at least one
	 * purpose OR ran `defer()`. The consent route uses this to avoid
	 * re-prompting users who already made a (possibly negative) choice.
	 */
	hasDecided(): boolean
}

export const IConsentService = DI.createInterface<IConsentService>(
	'IConsentService',
	(x) => x.singleton(ConsentService),
)

/**
 * Persisted shape on localStorage. `version` is a forward-compat seam: a
 * future change that needs richer per-purpose metadata (e.g. timestamps
 * per purpose) bumps the version and migrates `v1` payloads in
 * `hydrate()`.
 *
 * `decidedAt` carries the ISO timestamp of the user's first explicit
 * grant/revoke choice. `defer()` deliberately leaves this null and uses
 * a separate deferred flag in the storage adapter — keeping the two
 * signals separate preserves the distinction between "user explicitly
 * decided" and "user acknowledged the screen but skipped"; the latter
 * does NOT count as a privacy-respecting consent record.
 */

const DEFAULT_STATE: ConsentState = Object.freeze({
	analytics: false,
	marketingMeasurement: false,
})

/**
 * Singleton service owning per-purpose consent state. Hydrates from
 * localStorage on construction; corrupt blobs fall back to the
 * fail-closed default (`analytics: false`, `marketingMeasurement: false`)
 * rather than throwing — a crashed boot is strictly worse than a
 * silently-reset preference, and the user will be re-prompted via the
 * consent screen if `hasDecided()` reports false.
 */
export class ConsentService implements IConsentService {
	private readonly logger = resolve(ILogger).scopeTo('ConsentService')
	private readonly ea = resolve(IEventAggregator)

	private state: ConsentState = DEFAULT_STATE
	private decidedAt: string | null = null
	private deferred = false

	public constructor() {
		this.hydrate()
	}

	public get analytics(): boolean {
		return this.state.analytics
	}

	public get marketingMeasurement(): boolean {
		return this.state.marketingMeasurement
	}

	public grant(purpose: ConsentPurpose): void {
		this.applyMutation(purpose, true)
	}

	public revoke(purpose: ConsentPurpose): void {
		this.applyMutation(purpose, false)
	}

	public defer(): void {
		// `defer` is idempotent: re-deferring a user who already deferred
		// is a no-op (no event, no localStorage write). This keeps the
		// "Set up later" button safe to spam without amplifying log /
		// event noise. We still log on the first defer so the path is
		// visible in dev.
		if (this.deferred) return
		this.deferred = true
		if (!saveConsentDeferred()) {
			this.logger.warn('Failed to persist consent-deferred flag')
		}
		this.logger.debug('Consent decision deferred by user')
	}

	public hasDecided(): boolean {
		return this.decidedAt !== null || this.deferred
	}

	// -- Internals --------------------------------------------------------

	/**
	 * Applies a per-purpose mutation with three distinct branches:
	 *
	 *   1. Value changed: persist + publish ConsentChanged + log.
	 *   2. Value unchanged AND no prior explicit decision: stamp
	 *      decidedAt + persist + log; SKIP publish (no subscriber state
	 *      to update, but `hasDecided()` MUST flip so the consent screen
	 *      does not resurface on the next boot). This is the fresh-user
	 *      "Decline all" path where revoke('analytics') and
	 *      revoke('marketingMeasurement') both leave the value at the
	 *      default `false` — without this branch the explicit decline
	 *      would be silently dropped.
	 *   3. Value unchanged AND already decided: full no-op. Returning
	 *      users toggling the settings page back to a value they already
	 *      hold MUST NOT republish ConsentChanged (AnalyticsService
	 *      reads `set_config` as a side effect, so spurious republishes
	 *      would drive redundant SDK reconfiguration).
	 */
	private applyMutation(purpose: ConsentPurpose, value: boolean): void {
		const isNoOp = this.state[purpose] === value
		if (isNoOp && this.decidedAt !== null) return

		if (!isNoOp) {
			this.state = { ...this.state, [purpose]: value }
		}
		this.decidedAt = new Date().toISOString()
		if (!saveConsentState(this.state, this.decidedAt)) {
			this.logger.warn('Failed to persist consent state to localStorage')
		}
		if (!isNoOp) {
			this.ea.publish(new ConsentChanged(this.state))
		}
		this.logger.info('Consent state changed', { purpose, value })
	}

	private hydrate(): void {
		this.deferred = loadConsentDeferred()

		const parsed = loadConsentState()
		if (parsed === null) return

		this.state = {
			analytics: parsed.analytics,
			marketingMeasurement: parsed.marketingMeasurement,
		}
		this.decidedAt = parsed.decidedAt
	}
}
