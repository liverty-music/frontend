import { trace } from '@opentelemetry/api'
import {
	DI,
	type IDisposable,
	IEventAggregator,
	ILogger,
	resolve,
} from 'aurelia'
import type { PostHog, PostHogConfig } from 'posthog-js'
import { IAppConfig } from '../../config/app-config'
import {
	type EventName,
	type EventProps,
	Events,
} from '../../services/analytics-events'
import { ConsentChanged } from '../consent/consent-changed'
import { IConsentService } from '../consent/consent-service'
import {
	NOTIFICATION_FLUSH_MESSAGE,
	writeIdentitySnapshot,
} from './notification-interaction'
import {
	type SanitizedProps,
	sanitizeEventProps,
} from './sensitive-property-filter'

/**
 * Public surface for the typed PostHog wrapper. Every consumer (route VMs,
 * services, app-shell page-view wiring) MUST resolve through this interface
 * — the concrete class is registered as a singleton in `main.ts`. Keeping
 * the surface minimal protects call sites from PostHog SDK churn and makes
 * the nil-config / pre-init / opted-out branches the *only* code paths that
 * ever observe the wrapped SDK directly.
 *
 * Operates under the EU-adequacy opt-out model: identified analytics is
 * enabled by default for authenticated users; the user opts out from
 * settings. There is NO pre-collection consent gate.
 */
export interface IAnalyticsService {
	/**
	 * Typed event emission. The `name` literal pins the required property
	 * shape at compile time (see `analytics-events.ts`). Mismatched
	 * name/props pairs fail the typecheck.
	 *
	 * Behaviour matrix:
	 *   - nil-config (no `posthogProjectKey`): debug-log and return.
	 *   - pre-init: enqueue to a bounded in-memory buffer; flushed verbatim
	 *     on init.
	 *   - post-init: forward to PostHog with `trace_id` injected from the
	 *     active OTel span (best-effort).
	 *
	 * By default (not opted out) the FULL non-PII catalogue is captured
	 * anonymously before identification, persisted via `localStorage` with an
	 * anonymous id so anonymous funnels survive reloads. When the user has
	 * opted out, `posthog.opt_out_capturing()` suppresses every emission
	 * regardless of this method being called.
	 *
	 * Every payload passes through the 要配慮個人情報 (sensitive personal
	 * information) filter before reaching PostHog: sensitive categories and
	 * precise birth date / age are stripped, age-derived values bucketized.
	 */
	capture<E extends EventName>(name: E, props: EventProps<E>): void

	/**
	 * Associates the current session with the real user id. Called from
	 * `UserHydrationTask` after `UserService.GetMe`. No-op when analytics is
	 * opted out OR when running in nil-config mode. Does NOT call `reset()`
	 * on this path so the anonymous pre-identification history MERGES into
	 * the identified profile.
	 */
	identify(userId: string, properties?: Readonly<Record<string, unknown>>): void

	/**
	 * Clears the current identification (sign-out). Forwards to
	 * `posthog.reset()` once initialised; also clears the pre-init queue so
	 * any buffered events captured under the prior identity are dropped.
	 * No-op in nil-config mode.
	 */
	reset(): void

	/**
	 * Returns the current value of a PostHog feature flag, or the supplied
	 * default when nil-config, pre-init, or the flag is unknown. Synchronous
	 * by design so callers (route guards, UI gates) need not await init.
	 */
	getFeatureFlag(key: string, defaultValue: unknown): unknown
}

export const IAnalyticsService = DI.createInterface<IAnalyticsService>(
	'IAnalyticsService',
	(x) => x.singleton(AnalyticsService),
)

/**
 * Internal queue entry for captures issued before the SDK is loaded.
 * Stored as a discriminated `{ name, props }` rather than a closure so the
 * payload remains inspectable in tests and the flush path stays trivially
 * type-safe.
 */
type QueuedCapture = {
	[K in EventName]: { name: K; props: EventProps<K> }
}[EventName]

/**
 * Upper bound on the pre-init queue. The deferred-init window is bounded by
 * `requestIdleCallback` firing (at most ~2s due to the explicit timeout
 * below), so realistic pre-init traffic is a handful of events. 100 leaves
 * comfortable headroom while preventing a runaway page from flooding memory
 * if init somehow stalls.
 */
const PRE_INIT_QUEUE_LIMIT = 100

/**
 * Hard cap on how long the browser may defer the init callback. Without a
 * timeout, `requestIdleCallback` MAY never fire on a permanently busy tab.
 * 2 seconds is roughly the LCP budget for the dashboard.
 */
const INIT_IDLE_TIMEOUT_MS = 2_000

export class AnalyticsService implements IAnalyticsService {
	private readonly logger = resolve(ILogger).scopeTo('AnalyticsService')
	private readonly config = resolve(IAppConfig)
	private readonly consent = resolve(IConsentService)
	private readonly ea = resolve(IEventAggregator)

	/**
	 * Truthy iff PostHog initialisation has completed. Until this flips,
	 * `capture` enqueues; after it flips, `capture` forwards directly.
	 * Initialisation can fail (network, ad-blocker) — in that case `posthog`
	 * stays `null` and the service degrades to log-and-drop.
	 */
	private posthog: PostHog | null = null
	private initStarted = false
	private readonly queue: QueuedCapture[] = []
	private queueOverflowed = false

	/**
	 * Last distinct_id we identified, so the service-worker identity snapshot
	 * can be refreshed on an opt-out toggle even before/without the SDK
	 * resolving a distinct_id of its own. Notifications only reach signed-in
	 * users, so this is the recipient's platform user id in practice.
	 */
	private lastDistinctId: string | null = null

	/**
	 * Buffers the most recent `identify()` request fired BEFORE PostHog
	 * finished loading (e.g. UserHydrationTask runs as an AppTask.activating
	 * which can resolve faster than the requestIdleCallback that schedules
	 * `posthog.init`). The init callback consults this field and replays
	 * identify once the SDK is ready. Cleared on `reset()` and on opt-out.
	 */
	private pendingIdentify: {
		userId: string
		properties?: Readonly<Record<string, unknown>>
		internal: boolean
	} | null = null

	/**
	 * Buffers an opt-out transition that fired before PostHog finished
	 * loading. Carries `state.analytics` (whether analytics is enabled) so
	 * `init()` can apply the latest analytics posture once the SDK resolves.
	 */
	private pendingAnalyticsEnabled: boolean | null = null

	// NOTE: there is intentionally no pending-buffer for the sessionReplay
	// preference. Recording is hard-disabled in current scope (design
	// Decision 12), so a pre-init sessionReplay toggle has no SDK effect to
	// defer — only the persisted preference matters and ConsentService owns
	// that.

	private readonly consentSubscription: IDisposable

	public constructor() {
		// Subscribe BEFORE scheduling init so an opt-out emitted in the same
		// task as construction is captured — even in the test environment
		// where `scheduleInit` runs init synchronously, the subscribe call is
		// still ordered first.
		this.consentSubscription = this.ea.subscribe(
			ConsentChanged,
			(event: ConsentChanged) => this.handleConsentChanged(event),
		)
		this.scheduleInit()
	}

	public capture<E extends EventName>(name: E, props: EventProps<E>): void {
		if (!this.isEnabled()) {
			this.logger.debug('capture suppressed (nil-config mode)', { name })
			return
		}
		if (this.posthog === null) {
			this.enqueue({ name, props } as QueuedCapture)
			return
		}
		this.dispatch(name, props)
	}

	public identify(
		userId: string,
		properties?: Readonly<Record<string, unknown>>,
	): void {
		if (!this.isEnabled()) {
			this.logger.debug('identify suppressed (nil-config mode)', { userId })
			return
		}

		// Opted out: no identity link may be created. Do NOT buffer either —
		// while opted out, capture is fully suppressed, so there is no
		// anonymous telemetry to attribute, and re-enabling analytics later
		// re-runs identify via its own path.
		if (!this.consent.analytics) {
			this.logger.debug('identify suppressed (analytics opted out)', { userId })
			return
		}

		// Buffer for a pre-init replay. Sanitize identify properties through
		// the same sensitive-property filter as events.
		const safeProps =
			properties === undefined
				? undefined
				: sanitizeEventProps('identify', properties, this.logger)
		// Resolve the STABLE internal-identity marker: a user whose id is in
		// the configured allowlist is tagged `internal_traffic: true` so
		// production funnels / retention can filter the session out without
		// discarding it. NOT a heuristic — purely the configured list.
		const internal = this.isInternalUserId(userId)
		this.pendingIdentify = { userId, properties: safeProps, internal }

		if (this.posthog === null) {
			// Pre-init identify is intentionally dropped from the SDK path
			// rather than queued; the pendingIdentify buffer carries the
			// request (and its internal flag) and `init()` consults it after
			// the SDK loads, so a pre-init internal identify is still tagged.
			this.logger.debug('identify deferred to SDK init', { userId })
			return
		}
		// IMPORTANT: no preceding reset() — the anonymous pre-identification
		// history MERGES into the identified profile so pre-signup discovery
		// stays connected to post-signup conversion.
		this.applyIdentify(userId, safeProps, internal)
	}

	public reset(): void {
		if (!this.isEnabled()) {
			this.logger.debug('reset suppressed (nil-config mode)')
			return
		}
		// Clear any buffered events regardless of init state — they were
		// captured under the prior identity and forwarding them after a reset
		// would attribute pre-signout actions to the post-signout anonymous
		// id.
		this.queue.length = 0
		this.queueOverflowed = false
		this.pendingIdentify = null
		if (this.posthog === null) {
			this.logger.debug('reset queue-only (pre-init)')
			return
		}
		this.posthog.reset()
	}

	public getFeatureFlag(key: string, defaultValue: unknown): unknown {
		if (!this.isEnabled()) {
			return defaultValue
		}
		if (this.posthog === null) {
			return defaultValue
		}
		const value = this.posthog.getFeatureFlag(key)
		return value === undefined ? defaultValue : value
	}

	// -- Internals --------------------------------------------------------

	/** Nil-config mirror of the backend's `client == nil` short-circuit. */
	private isEnabled(): boolean {
		return Boolean(this.config.posthogProjectKey)
	}

	/**
	 * Schedules the actual SDK import + init for the next idle slot. Using
	 * `requestIdleCallback` keeps PostHog's dynamic import off the critical
	 * path so it cannot regress INP / LCP. Safari < 16 lacks
	 * `requestIdleCallback`; fall back to `setTimeout(0)`.
	 */
	private scheduleInit(): void {
		if (this.initStarted) return
		this.initStarted = true
		if (!this.isEnabled()) {
			return
		}
		const win = globalThis as typeof globalThis & {
			requestIdleCallback?: (
				cb: () => void,
				opts?: { timeout: number },
			) => unknown
		}
		const run = (): void => {
			void this.init()
		}
		if (typeof win.requestIdleCallback === 'function') {
			win.requestIdleCallback(run, { timeout: INIT_IDLE_TIMEOUT_MS })
		} else {
			setTimeout(run, 0)
		}
	}

	/**
	 * Loads the PostHog SDK dynamically (kept out of the main bundle) and
	 * initialises it. Under the opt-out model the DEFAULT posture is fully
	 * enabled: `persistence: 'localStorage+cookie'` with an anonymous id so
	 * anonymous discovery funnels survive reloads and later merge into the
	 * identified profile. When the user has opted out, the privacy posture
	 * (`persistence: 'memory'`, `ip: false`) PLUS `opt_out_capturing()` is
	 * applied so nothing emits.
	 *
	 * Failure here is non-fatal — the catch path logs and leaves `posthog ===
	 * null`, so subsequent captures fall back to the nil-config branch. We do
	 * NOT retry: a failed init usually means an ad-blocker is in play.
	 */
	private async init(): Promise<void> {
		try {
			const module = await import('posthog-js')
			const posthog = module.default
			const apiHost =
				this.config.posthogApiHost && this.config.posthogApiHost.length > 0
					? this.config.posthogApiHost
					: 'https://eu.i.posthog.com'

			// Resolve the analytics posture to apply: a pre-init transition
			// takes priority, otherwise the live opt-out state.
			const analyticsEnabled =
				this.pendingAnalyticsEnabled !== null
					? this.pendingAnalyticsEnabled
					: this.consent.analytics
			this.pendingAnalyticsEnabled = null

			// The session-replay opt-out preference is read + persisted by
			// ConsentService, but the actual recording stays hard-disabled in
			// current scope (see `applySessionReplayToSdk` / design Decision
			// 12), so there is nothing to apply from it here.

			const initConfig: Partial<PostHogConfig> = {
				api_host: apiHost,
				// Default-on posture: persist the anonymous id so anonymous
				// funnels survive reloads and merge into the identified profile.
				// The opt-out branch below downgrades this to memory-only.
				persistence: analyticsEnabled ? 'localStorage+cookie' : 'memory',
				ip: analyticsEnabled,
				// Autocapture is disabled: every event is catalogued through
				// `analytics-events.ts`. Implicit captures would create rogue
				// events outside the catalogue.
				autocapture: false,
				// AnalyticsService orchestrates page views and identification
				// itself rather than via SDK helpers.
				capture_pageview: false,
				// Session recording is hard-disabled in current scope per design
				// Decision 12 — replay-dependent PII masking (tasks 8.1–8.3) and
				// sampling (8.5) are not yet implemented, so recording must never
				// start regardless of the user's sessionReplay preference. The
				// `sessionReplay` consent value is still tracked so the toggle
				// reflects the user's intent for when replay ships.
				disable_session_recording: true,
				loaded: () => {
					this.logger.debug('PostHog SDK loaded')
				},
			}
			posthog.init(this.config.posthogProjectKey, initConfig)
			this.posthog = posthog

			if (analyticsEnabled) {
				// Default state: ensure capture is opted in (the SDK persists
				// the opt flag, so a returning user who opted out then back in
				// needs an explicit opt_in_capturing).
				posthog.opt_in_capturing()
				// Reassert the recording posture (no-op enable yet — see below).
				this.applySessionReplayToSdk()
			} else {
				// Opted out: suppress all capture and revert to memory-only.
				this.applyAnalyticsOptOutToSdk()
			}

			this.flushQueue()
			// Replay a buffered identify AFTER the queue flush so any pre-init
			// `capture` is attributed to the anonymous id first; identify then
			// MERGES that history into the real user_id (no reset()).
			this.replayPendingIdentifyIfAllowed()
			// Publish the initial snapshot (covers the opted-out-at-boot and
			// no-pending-identify cases) and flush any interactions the SW
			// stashed while offline on a prior session.
			this.syncIdentitySnapshot()
			this.nudgeServiceWorkerFlush()
		} catch (err) {
			this.logger.warn(
				'PostHog SDK failed to load; analytics disabled for this session',
				{ error: err },
			)
		}
	}

	private enqueue(entry: QueuedCapture): void {
		if (this.queue.length >= PRE_INIT_QUEUE_LIMIT) {
			if (!this.queueOverflowed) {
				this.queueOverflowed = true
				this.logger.warn(
					'Analytics pre-init queue overflowed; subsequent events dropped until init completes',
					{ limit: PRE_INIT_QUEUE_LIMIT },
				)
			}
			return
		}
		this.queue.push(entry)
	}

	private flushQueue(): void {
		if (this.queue.length === 0) return
		const pending = this.queue.splice(0, this.queue.length)
		for (const entry of pending) {
			this.dispatch(entry.name, entry.props)
		}
	}

	/**
	 * The single place that touches `posthog.capture`. Runs every payload
	 * through the 要配慮個人情報 filter (sensitive categories + precise
	 * birth date / age stripped, age-derived values bucketized) and injects
	 * the active OTel `trace_id` so paired FE/BE events can be correlated.
	 */
	private dispatch<E extends EventName>(name: E, props: EventProps<E>): void {
		if (this.posthog === null) return
		const sanitized: SanitizedProps = sanitizeEventProps(
			name,
			props,
			this.logger,
		)
		const enriched: Record<string, unknown> = { ...sanitized }
		const span = trace.getActiveSpan()
		if (span !== undefined) {
			const ctx = span.spanContext()
			if (ctx.traceId && ctx.traceId.length > 0) {
				enriched.trace_id = ctx.traceId
			}
		}
		this.posthog.capture(name, enriched)
	}

	/**
	 * React to an opt-out state transition. `analytics` controls event
	 * capture / identification / persistence:
	 *   - analytics ON  → opt_in_capturing + localStorage+cookie + identify
	 *     merge (NO reset); analytics OFF → opt_out_capturing + reset +
	 *     memory-only.
	 *
	 * The `sessionReplay` preference is read + persisted by ConsentService,
	 * but the actual recording is hard-disabled in current scope (design
	 * Decision 12), so toggling it does NOT start/stop recording here — see
	 * `applySessionReplayToSdk`. Event capture and identity are unaffected by
	 * the sessionReplay toggle either way.
	 *
	 * Tolerates pre-init firing: the latest analytics value is buffered and
	 * applied inside `init()` once the SDK loads.
	 */
	private handleConsentChanged(event: ConsentChanged): void {
		const analyticsEnabled = event.state.analytics
		if (this.posthog === null) {
			this.pendingAnalyticsEnabled = analyticsEnabled
			// sessionReplay preference is intentionally not buffered for an SDK
			// effect: recording stays off in current scope regardless.
			return
		}
		if (analyticsEnabled) {
			this.posthog.opt_in_capturing()
			this.posthog.set_config({
				persistence: 'localStorage+cookie',
				ip: true,
			})
			// Re-identify if a user_id was buffered (e.g. UserHydrationTask
			// ran while opted out — though identify() does not buffer in that
			// case; this covers a re-enable within the same boot). No reset().
			this.replayPendingIdentifyIfAllowed()
			this.logger.debug('Analytics opted in — persistence upgraded')
		} else {
			this.applyAnalyticsOptOutToSdk()
			this.logger.debug('Analytics opted out — capture suppressed')
		}
		// Reflect the new opt-out posture into the service-worker snapshot so
		// notificationclick / notificationclose honour it immediately.
		this.syncIdentitySnapshot()
		// Reassert the recording posture. This is a no-op enable in current
		// scope (recording stays disabled per Decision 12) but keeps the
		// single wiring point explicit for when replay ships.
		this.applySessionReplayToSdk()
	}

	/**
	 * Opted-out posture: suppress all capture, revert persistence to
	 * memory-only, drop IP, and reset() to sever any identity link. Drops the
	 * buffered identify so a future re-enable does not silently re-identify
	 * with a stale user_id.
	 */
	private applyAnalyticsOptOutToSdk(): void {
		if (this.posthog === null) return
		this.posthog.opt_out_capturing()
		this.posthog.set_config({ persistence: 'memory', ip: false })
		this.posthog.reset()
		this.pendingIdentify = null
	}

	/**
	 * SINGLE WIRING POINT for PostHog session recording — never touches
	 * capture or identity.
	 *
	 * Session replay is HARD-DISABLED in current scope per design Decision
	 * 12: the replay-dependent PII masking (tasks 8.1–8.3) and sampling (8.5)
	 * are not yet implemented, so enabling recording would re-introduce a
	 * PII-leak + free-tier-cost risk. Recording therefore stays off
	 * regardless of the user's `sessionReplay` opt-out preference — the
	 * preference is still tracked + persisted so the settings toggle reflects
	 * the user's intent for WHEN replay ships.
	 *
	 * To deliberately enable replay once masking + sampling land, gate the
	 * recording state on `this.consent.sessionReplay` here (e.g.
	 * `disable_session_recording: !(this.consent.analytics &&
	 * this.consent.sessionReplay)`) plus the masking/sampling init config.
	 * This is the ONLY place that should flip recording on.
	 */
	private applySessionReplayToSdk(): void {
		if (this.posthog === null) return
		this.posthog.set_config({ disable_session_recording: true })
	}

	/**
	 * Calls `posthog.identify` with the buffered user_id iff the SDK is
	 * loaded AND analytics is not opted out. No reset() precedes it, so the
	 * anonymous history merges. One-shot: clears `pendingIdentify` after
	 * dispatch so the steady-state boot path does not double-dispatch.
	 */
	private replayPendingIdentifyIfAllowed(): void {
		if (this.posthog === null) return
		if (!this.consent.analytics) return
		const buffered = this.pendingIdentify
		if (buffered === null) return
		this.pendingIdentify = null
		this.applyIdentify(buffered.userId, buffered.properties, buffered.internal)
	}

	/**
	 * The single place that calls `posthog.identify`. Applies the
	 * `internal_traffic` marker for an allowlisted (internal) user:
	 *   - adds `internal_traffic: true` as a PERSON property on the identify
	 *     call (person-level dashboard filters), AND
	 *   - registers it as a SUPER property so every subsequently captured
	 *     event also carries `internal_traffic: true` (event-level filters).
	 *
	 * The flag is a plain boolean — not PII — so it intentionally bypasses the
	 * 要配慮 sensitive-property filter (which only touches event payloads) and
	 * survives into PostHog unchanged. A non-internal user takes the
	 * unchanged path: no extra property, no register call.
	 */
	private applyIdentify(
		userId: string,
		properties: Readonly<Record<string, unknown>> | undefined,
		internal: boolean,
	): void {
		if (this.posthog === null) return
		this.lastDistinctId = userId
		if (!internal) {
			this.posthog.identify(userId, properties)
		} else {
			this.posthog.identify(userId, { ...properties, internal_traffic: true })
			// Super-property: stamps every future capture so event-level filters
			// (not just person-level) can exclude internal traffic.
			this.posthog.register({ internal_traffic: true })
		}
		// Refresh the service-worker identity snapshot so notificationclick /
		// notificationclose can attribute interactions to this user and honour
		// the current opt-out state.
		this.syncIdentitySnapshot()
	}

	/**
	 * Persists the `{ distinct_id, opted_out, api_host, project_key }` snapshot
	 * the service worker reads to report notification opens / dismissals (the
	 * SW cannot run posthog-js). Best-effort and fire-and-forget: a Cache write
	 * failure only means the SW keeps the prior snapshot. Skipped in nil-config
	 * mode or before any distinct_id is known.
	 */
	private syncIdentitySnapshot(): void {
		if (!this.isEnabled()) return
		// Prefer the SDK's live distinct_id; fall back to the last identify.
		// Guard the call so a stubbed/partial SDK cannot throw here.
		const fromSdk =
			typeof this.posthog?.get_distinct_id === 'function'
				? this.posthog.get_distinct_id()
				: undefined
		const distinctId = fromSdk ?? this.lastDistinctId
		if (distinctId === null || distinctId === undefined || distinctId === '') {
			return
		}
		const apiHost =
			this.config.posthogApiHost && this.config.posthogApiHost.length > 0
				? this.config.posthogApiHost
				: 'https://eu.i.posthog.com'
		void writeIdentitySnapshot({
			distinctId,
			optedOut: !this.consent.analytics,
			apiHost,
			projectKey: this.config.posthogProjectKey ?? '',
		}).catch((err) => {
			this.logger.debug('identity snapshot write failed', { error: err })
		})
	}

	/**
	 * Nudges the active service worker to flush any interactions it stashed
	 * while offline. Called once on init so a reconnect-then-reopen delivers
	 * queued opens / dismissals even on browsers without Background Sync.
	 */
	private nudgeServiceWorkerFlush(): void {
		const nav = (globalThis as { navigator?: Navigator }).navigator
		const container = nav?.serviceWorker
		if (container === undefined) return
		void container.ready
			.then((registration) => {
				registration.active?.postMessage({ type: NOTIFICATION_FLUSH_MESSAGE })
			})
			.catch(() => {
				// No controlling SW yet (first load) — nothing to flush.
			})
	}

	/**
	 * True iff `userId` is in the configured internal-traffic allowlist. The
	 * empty / missing-config case (the normal production user) returns false,
	 * so no marker is applied.
	 */
	private isInternalUserId(userId: string): boolean {
		return this.config.internalTrafficUserIds.includes(userId)
	}

	/**
	 * Disposes the consent subscription. AnalyticsService is a singleton and
	 * lives for the full page lifetime, so production code never calls this;
	 * tests use it to release the IEventAggregator subscription.
	 */
	public dispose(): void {
		this.consentSubscription.dispose()
	}

	/**
	 * @internal Test hook — awaits the queued init so specs don't have to
	 *   poll `requestIdleCallback` timing.
	 */
	public async _waitForInitForTests(): Promise<void> {
		await new Promise((r) => setTimeout(r, 0))
		if (this.posthog === null && this.isEnabled()) {
			await this.init()
		}
	}
}

// Re-export the catalogue for ergonomic single-import consumption at
// instrumented call sites.
export { Events }
