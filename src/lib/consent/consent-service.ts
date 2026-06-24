import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import {
	loadConsentState,
	saveConsentState,
} from '../../adapter/storage/consent-storage'
import { ConsentChanged } from './consent-changed'

/**
 * Per-purpose opt-out state for product analytics and session replay.
 * Surfaced read-only via `IConsentService`; the shape mirrors the persisted
 * record so downstream consumers (notably `AnalyticsService`) never see
 * anything richer than the user's current opt-out posture.
 *
 * Legal model (EU-adequacy opt-out, NOT a consent gate):
 *   Identified product analytics is enabled by default for authenticated
 *   users. Cross-border transfer of personal data to PostHog (Klant
 *   Solutions B.V., Netherlands) is permitted WITHOUT per-user statutory
 *   consent under APPI Article 28, because the EU has held the Personal
 *   Information Protection Commission's adequacy designation since January
 *   2019. The surviving obligation is the notification/publication of the
 *   purpose of use (利用目的の通知・公表), satisfied by the privacy policy
 *   plus an always-available opt-out — NOT by a signup consent screen.
 *
 * Field semantics (both default ON / not-opted-out):
 *   - `analytics`: covers PostHog event capture, identification with the
 *     real user id, and persistent storage (localStorage / cookies). When
 *     false (opted out), AnalyticsService suppresses all capture
 *     (`opt_out_capturing`), reverts to memory-only persistence, and resets
 *     the identity link.
 *   - `sessionReplay`: covers session recording ONLY. When false (opted
 *     out), session recording is disabled via `set_config`; event capture
 *     and identity are unaffected.
 *
 * APPI 要配慮個人情報 (sensitive personal information) is NEVER governed by
 * this opt-out state: sensitive categories always require explicit opt-in
 * and cannot be acquired via opt-out, so their exclusion is enforced
 * structurally in `AnalyticsService` (property allowlist + replay masking),
 * not here.
 */
export type ConsentState = {
	readonly analytics: boolean
	readonly sessionReplay: boolean
}

/** Consent purpose name; mirrors the keys of `ConsentState`. */
export type ConsentPurpose = 'analytics' | 'sessionReplay'

/**
 * Read + mutate surface for the per-purpose opt-out state. Read getters
 * (`analytics`, `sessionReplay`) report the current posture (`true` = not
 * opted out = enabled). Mutators (`grant`, `revoke`) flip a purpose and
 * are consumed by the settings page opt-out toggles.
 *
 * Every mutator MUST write back to localStorage AND publish a
 * `ConsentChanged` event on `IEventAggregator` so subscribers (currently
 * just `AnalyticsService`) can update their SDK posture synchronously with
 * the user's choice.
 */
export interface IConsentService {
	/**
	 * `true` iff analytics is enabled (the default; user has not opted out).
	 * Covers PostHog event capture, identification with the real user id,
	 * and persistent client-side storage. Polled by `AnalyticsService`.
	 */
	readonly analytics: boolean
	/**
	 * `true` iff session replay is enabled (the default; user has not opted
	 * out). Controls session recording only — independent of `analytics`.
	 */
	readonly sessionReplay: boolean

	/** Opt a purpose back IN (enable); persists + publishes `ConsentChanged`. */
	grant(purpose: ConsentPurpose): void
	/** Opt OUT of a purpose (disable); persists + publishes `ConsentChanged`. */
	revoke(purpose: ConsentPurpose): void
}

export const IConsentService = DI.createInterface<IConsentService>(
	'IConsentService',
	(x) => x.singleton(ConsentService),
)

/**
 * Default-on posture: both purposes enabled. Under the EU-adequacy opt-out
 * model a fresh authenticated user with no stored decision reads as BOTH ON
 * — analytics is enabled by default and the user opts out at will. This
 * replaces the former fail-closed (`false`) opt-in defaults.
 */
const DEFAULT_STATE: ConsentState = Object.freeze({
	analytics: true,
	sessionReplay: true,
})

/**
 * Singleton service owning the per-purpose opt-out state. Hydrates from
 * localStorage on construction; corrupt or absent blobs fall back to the
 * default-on posture rather than throwing — a crashed boot is strictly
 * worse than a silently re-defaulted preference, and default-on is the
 * intended posture for a fresh account under the opt-out model.
 */
export class ConsentService implements IConsentService {
	private readonly logger = resolve(ILogger).scopeTo('ConsentService')
	private readonly ea = resolve(IEventAggregator)

	// `@observable` so the `analytics` / `sessionReplay` getters re-evaluate
	// every dependent binding (e.g. the Settings opt-out toggles) on
	// reassignment — consumers bind the getters directly with no
	// component-local mirror. Mutated via immutable reassignment in
	// `applyMutation`, which is what the observable setter needs to fire.
	@observable private state: ConsentState = DEFAULT_STATE

	public constructor() {
		this.hydrate()
	}

	public get analytics(): boolean {
		return this.state.analytics
	}

	public get sessionReplay(): boolean {
		return this.state.sessionReplay
	}

	public grant(purpose: ConsentPurpose): void {
		this.applyMutation(purpose, true)
	}

	public revoke(purpose: ConsentPurpose): void {
		this.applyMutation(purpose, false)
	}

	// -- Internals --------------------------------------------------------

	/**
	 * Applies a per-purpose opt-out mutation. A no-op (value unchanged) does
	 * NOT persist or publish — re-toggling a purpose to a value it already
	 * holds MUST NOT republish `ConsentChanged`, since `AnalyticsService`
	 * reads it as a `set_config` / opt trigger and a spurious republish would
	 * drive redundant SDK reconfiguration.
	 */
	private applyMutation(purpose: ConsentPurpose, value: boolean): void {
		if (this.state[purpose] === value) return
		this.state = { ...this.state, [purpose]: value }
		if (!saveConsentState(this.state)) {
			this.logger.warn('Failed to persist consent state to localStorage')
		}
		this.ea.publish(new ConsentChanged(this.state))
		this.logger.info('Opt-out state changed', { purpose, value })
	}

	private hydrate(): void {
		const parsed = loadConsentState()
		if (parsed === null) return
		this.state = {
			analytics: parsed.analytics,
			sessionReplay: parsed.sessionReplay,
		}
	}
}
