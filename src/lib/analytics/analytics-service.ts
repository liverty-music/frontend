import { IRouterEvents } from '@aurelia/router'
import { trace } from '@opentelemetry/api'
import {
	DI,
	type IDisposable,
	IEventAggregator,
	ILogger,
	resolve,
} from 'aurelia'
import type { CaptureOptions, PostHog, PostHogConfig } from 'posthog-js'
import { IAppConfig } from '../../config/app-config'
import {
	type AuthStartSource,
	type EventName,
	type EventProps,
	Events,
} from '../../services/analytics-events'
import { AuthStarted } from '../../services/events/auth-started'
import { SignedOut } from '../../services/events/signed-out'
import { ConsentChanged } from '../consent/consent-changed'
import { IConsentService } from '../consent/consent-service'
import { filterAnalyticsEvent } from './error-report-filter'
import {
	NOTIFICATION_FLUSH_MESSAGE,
	writeIdentitySnapshot,
} from './notification-interaction'
import {
	type SanitizedProps,
	sanitizeEventProps,
} from './sensitive-property-filter'
import { isUnrecordedPath, sessionRecordingOptions } from './session-recording'

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

	/**
	 * Sends an error report (`$exception`) for `error`, passed as it was
	 * thrown or rejected so the SDK keeps its cause chain and non-`Error`
	 * values. Returns `true` only when the SDK accepted the event into its
	 * send queue; `false` in nil-config mode, when opted out, when the SDK
	 * dropped it (rate limit, extension error) or threw. Never throws.
	 *
	 * Before init with analytics on, the report is queued, init starts at
	 * once, and `onAccepted` is called if the SDK accepts it at flush.
	 */
	captureException(
		error: unknown,
		props: Readonly<Record<string, unknown>>,
		onAccepted?: () => void,
	): boolean

	/**
	 * Adds a step the SDK attaches to the next error report. Queued before
	 * init; no-op in nil-config mode.
	 */
	addExceptionStep(
		label: string,
		props: Readonly<Record<string, unknown>>,
	): void
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

/** A queued error report or exception step, replayed in order with events. */
type QueuedException = {
	exception: unknown
	props: Readonly<Record<string, unknown>>
	onAccepted?: () => void
}
type QueuedStep = { step: string; props: Readonly<Record<string, unknown>> }
type QueuedEntry = QueuedCapture | QueuedException | QueuedStep

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

/**
 * `standalone` when the app runs installed (home-screen icon), `browser` in a
 * browser tab. iOS Safari reports an installed app through
 * `navigator.standalone` rather than the media query.
 */
function displayMode(): 'standalone' | 'browser' {
	const iosStandalone =
		(navigator as { standalone?: boolean }).standalone === true
	return iosStandalone ||
		window.matchMedia('(display-mode: standalone)').matches
		? 'standalone'
		: 'browser'
}

export class AnalyticsService implements IAnalyticsService {
	private readonly logger = resolve(ILogger).scopeTo('AnalyticsService')
	private readonly config = resolve(IAppConfig)
	private readonly consent = resolve(IConsentService)
	private readonly ea = resolve(IEventAggregator)
	private readonly routerEvents = resolve(IRouterEvents)

	/**
	 * Truthy iff PostHog initialisation has completed. Until this flips,
	 * `capture` enqueues; after it flips, `capture` forwards directly.
	 * Initialisation can fail (network, ad-blocker) — in that case `posthog`
	 * stays `null` and the service degrades to log-and-drop.
	 */
	private posthog: PostHog | null = null
	private initStarted = false
	private initPromise: Promise<void> | null = null
	private readonly queue: QueuedEntry[] = []
	private queueOverflowed = false
	// True while the pre-init queue drains in idle slices; new captures queue
	// behind it so events keep their order.
	private flushing = false

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
	// preference: `init()` reads it from ConsentService, which already holds
	// the latest value.

	private readonly consentSubscription: IDisposable
	private readonly signedOutSubscription: IDisposable
	private readonly authStartedSubscription: IDisposable
	private readonly navigationSubscription: IDisposable
	// The recording posture last given to the SDK, so a navigation that does
	// not change it does not reconfigure the SDK.
	private recordingDisabled: boolean | null = null

	public constructor() {
		// Subscribe BEFORE scheduling init so an opt-out emitted in the same
		// task as construction is captured — even in the test environment
		// where `scheduleInit` runs init synchronously, the subscribe call is
		// still ordered first.
		this.consentSubscription = this.ea.subscribe(
			ConsentChanged,
			(event: ConsentChanged) => this.handleConsentChanged(event),
		)
		// A sign-out ends the identified session: later events must not be
		// attributed to the user who signed out.
		this.signedOutSubscription = this.ea.subscribe(SignedOut, () =>
			this.reset(),
		)
		// AuthService (in `shared/`) cannot reach this service, so it publishes
		// each start of sign-up or sign-in just before the redirect.
		this.authStartedSubscription = this.ea.subscribe(
			AuthStarted,
			(event: AuthStarted) => this.handleAuthStarted(event),
		)
		// Recording stops on a screen that is never recorded and resumes on
		// the next one.
		this.navigationSubscription = this.routerEvents.subscribe(
			'au:router:navigation-end',
			() =>
				this.applySessionReplayToSdk(
					this.consent.sessionReplay,
					this.analyticsEnabled(),
				),
		)
		this.scheduleInit()
	}

	public capture<E extends EventName>(name: E, props: EventProps<E>): void {
		if (!this.isEnabled()) {
			this.logger.debug('capture suppressed (nil-config mode)', { name })
			return
		}
		if (this.posthog === null || this.flushing) {
			this.enqueue({ name, props } as QueuedCapture)
			return
		}
		this.dispatch(name, props)
	}

	/**
	 * Reports a start of sign-up or sign-in. The page leaves for hosted login
	 * right after, so the event is sent at once (`fetch` with keepalive
	 * outlives the navigation) rather than left in the SDK's batch queue.
	 * Before init it is queued like any event and is lost if the page leaves
	 * first.
	 */
	private handleAuthStarted(event: AuthStarted): void {
		if (event.source === undefined) return
		const props = {
			kind: event.kind,
			source: event.source as AuthStartSource,
		}
		if (this.isEnabled() && this.posthog !== null && !this.flushing) {
			this.dispatch(Events.AuthStarted, props, { send_instantly: true })
			return
		}
		this.capture(Events.AuthStarted, props)
	}

	public captureException(
		error: unknown,
		props: Readonly<Record<string, unknown>>,
		onAccepted?: () => void,
	): boolean {
		try {
			if (!this.isEnabled() || !this.analyticsEnabled()) return false
			if (this.posthog === null || this.flushing) {
				this.enqueue({ exception: error, props, onAccepted })
				// An error early in a visit should not wait for the idle slot:
				// the banner switches to the sent copy once this is accepted.
				if (this.posthog === null) void this.init()
				return false
			}
			return this.dispatchException(error, props)
		} catch (err) {
			this.logger.warn('Error report failed', { error: err })
			return false
		}
	}

	public addExceptionStep(
		label: string,
		props: Readonly<Record<string, unknown>>,
	): void {
		try {
			if (!this.isEnabled()) return
			if (this.posthog === null || this.flushing) {
				this.enqueue({ step: label, props })
				return
			}
			this.posthog.addExceptionStep(label, props)
		} catch (err) {
			this.logger.warn('Exception step failed', { error: err })
		}
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
		this.lastDistinctId = null
		if (this.posthog === null) {
			this.logger.debug('reset queue-only (pre-init)')
			return
		}
		this.posthog.reset()
		// reset() clears the SDK's consent state; a fan who opted out stays
		// opted out after signing out.
		if (!this.consent.analytics) this.posthog.opt_out_capturing()
		// Point the service-worker snapshot at the new anonymous id.
		this.syncIdentitySnapshot()
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

	/** The analytics posture, counting a transition that arrived before init. */
	private analyticsEnabled(): boolean {
		return this.pendingAnalyticsEnabled ?? this.consent.analytics
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
	 *
	 * Idempotent: the idle slot and a first error report may both start it.
	 */
	private init(): Promise<void> {
		this.initPromise ??= this.loadAndInit()
		return this.initPromise
	}

	private async loadAndInit(): Promise<void> {
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
			const origin = window.location.origin

			const initConfig: Partial<PostHogConfig> = {
				api_host: apiHost,
				// Links the SDK shows (toolbar) go to the PostHog app, not to the
				// reverse proxy `api_host` may point at.
				ui_host: 'https://eu.posthog.com',
				// Default-on posture: persist the anonymous id so anonymous
				// funnels survive reloads and merge into the identified profile.
				// The opt-out branch below downgrades this to memory-only.
				persistence: analyticsEnabled ? 'localStorage+cookie' : 'memory',
				ip: analyticsEnabled,
				// Autocapture is disabled: every event is catalogued through
				// `analytics-events.ts`. Implicit captures would create rogue
				// events outside the catalogue.
				autocapture: false,
				// One page view per screen: the SDK sends one at load and one
				// each time the router changes the path. A change of the query
				// string alone is not a page view ('history_change' compares the
				// path only). Leaving the app sends a page leave.
				capture_pageview: 'history_change',
				capture_pageleave: true,
				// Recording needs both Analytics and Session replay on, and a
				// screen that is recorded; `applySessionReplayToSdk` reapplies it.
				disable_session_recording: this.recordingOff(
					this.consent.sessionReplay,
					analyticsEnabled,
				),
				session_recording: sessionRecordingOptions(origin),
				// Console output is not masked text: the app's logs name artists,
				// ids and errors. The project's console-log setting must not add
				// it to recordings.
				enable_recording_console_log: false,
				// Error reports go only through `captureException`, which carries
				// the banner's Error ID. A project-side "exception autocapture"
				// toggle must not add a second, ID-less capture path.
				capture_exceptions: false,
				// No address on the app's own origin leaves the device with its
				// query or fragment: a referral code (`?ref=`) or a later link
				// value stays on the platform (OpenSpec `referral-attribution`,
				// design D11). An error report keeps the dashboard filter keys
				// and has tokens redacted (OpenSpec `global/analytics`).
				before_send: (event) => filterAnalyticsEvent(event, origin),
				loaded: () => {
					this.logger.debug('PostHog SDK loaded')
				},
			}
			posthog.init(this.config.posthogProjectKey, initConfig)
			this.posthog = posthog
			this.recordingDisabled = initConfig.disable_session_recording ?? null
			// Every event states whether the app runs installed or in a tab.
			posthog.register({ display_mode: displayMode() })

			if (analyticsEnabled) {
				// Default state: ensure capture is opted in (the SDK persists
				// the opt flag, so a returning user who opted out then back in
				// needs an explicit opt_in_capturing).
				posthog.opt_in_capturing()
				this.applySessionReplayToSdk(this.consent.sessionReplay)
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

	private enqueue(entry: QueuedEntry): void {
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

	/**
	 * Replays the pre-init queue. Each capture costs the SDK cookie, storage
	 * and property work, and a cold load can queue dozens (long-frame events
	 * pile up while the app boots), so replaying them in one task held the main
	 * thread for over a second at 4x CPU throttling right while Discovery's
	 * first data arrived. Where `requestIdleCallback` exists, the queue drains
	 * in idle slices, at least one event per slice; elsewhere it drains at
	 * once.
	 */
	private flushQueue(): void {
		if (this.queue.length === 0) return
		const win = globalThis as typeof globalThis & {
			requestIdleCallback?: (
				cb: (deadline: { timeRemaining(): number }) => void,
				opts?: { timeout: number },
			) => unknown
		}
		const idle = win.requestIdleCallback
		if (typeof idle !== 'function') {
			for (const entry of this.queue.splice(0, this.queue.length)) {
				this.replay(entry)
			}
			return
		}
		this.flushing = true
		const slice = (deadline: { timeRemaining(): number }): void => {
			do {
				const entry = this.queue.shift()
				if (entry === undefined) break
				this.replay(entry)
			} while (this.queue.length > 0 && deadline.timeRemaining() > 1)
			if (this.queue.length > 0) {
				idle(slice, { timeout: INIT_IDLE_TIMEOUT_MS })
			} else {
				this.flushing = false
			}
		}
		idle(slice, { timeout: INIT_IDLE_TIMEOUT_MS })
	}

	/** Forwards one queued entry to the SDK. */
	private replay(entry: QueuedEntry): void {
		if ('exception' in entry) {
			if (this.dispatchException(entry.exception, entry.props)) {
				entry.onAccepted?.()
			}
		} else if ('step' in entry) {
			this.posthog?.addExceptionStep(entry.step, entry.props)
		} else {
			this.dispatch(entry.name, entry.props)
		}
	}

	/**
	 * The single place that touches `posthog.captureException`. The SDK
	 * returns `undefined` when capture is opted out, rate-limited or the error
	 * was dropped, so only a returned result counts as accepted.
	 */
	private dispatchException(
		error: unknown,
		props: Readonly<Record<string, unknown>>,
	): boolean {
		if (this.posthog === null) return false
		try {
			return this.posthog.captureException(error, { ...props }) !== undefined
		} catch (err) {
			this.logger.warn('Error report failed', { error: err })
			return false
		}
	}

	/**
	 * The single place that touches `posthog.capture`. Runs every payload
	 * through the 要配慮個人情報 filter (sensitive categories + precise
	 * birth date / age stripped, age-derived values bucketized) and injects
	 * the active OTel `trace_id` so paired FE/BE events can be correlated.
	 */
	private dispatch<E extends EventName>(
		name: E,
		props: EventProps<E>,
		options?: CaptureOptions,
	): void {
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
		this.posthog.capture(name, enriched, options)
	}

	/**
	 * React to an opt-out state transition. `analytics` controls event
	 * capture / identification / persistence:
	 *   - analytics ON  → opt_in_capturing + localStorage+cookie + identify
	 *     merge (NO reset); analytics OFF → opt_out_capturing + reset +
	 *     memory-only.
	 *
	 * `sessionReplay` starts or stops the session recording (with analytics
	 * on); event capture and identity are unaffected by it.
	 *
	 * Tolerates pre-init firing: the latest analytics value is buffered and
	 * applied inside `init()` once the SDK loads.
	 */
	private handleConsentChanged(event: ConsentChanged): void {
		const analyticsEnabled = event.state.analytics
		if (this.posthog === null) {
			this.pendingAnalyticsEnabled = analyticsEnabled
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
		this.applySessionReplayToSdk(event.state.sessionReplay, analyticsEnabled)
	}

	/**
	 * Opted-out posture: suppress all capture, revert persistence to
	 * memory-only, drop IP, and reset() to sever any identity link. Drops the
	 * buffered identify so a future re-enable does not silently re-identify
	 * with a stale user_id.
	 */
	private applyAnalyticsOptOutToSdk(): void {
		if (this.posthog === null) return
		// reset() clears the SDK's consent state too, so it runs BEFORE the
		// opt-out: in the other order the opt-out is undone at once and
		// capture resumes.
		this.posthog.reset()
		this.posthog.opt_out_capturing()
		this.posthog.set_config({ persistence: 'memory', ip: false })
		this.pendingIdentify = null
	}

	/**
	 * SINGLE WIRING POINT for PostHog session recording — never touches
	 * capture or identity. Recording runs only while both Analytics and
	 * Session replay are on and the screen shown is recorded (OpenSpec
	 * `global/analytics`, "Session recordings hide what the fan types and
	 * reads"); what is masked is fixed at init by {@link sessionRecordingOptions}.
	 * `set_config` makes the SDK start or stop its recorder.
	 */
	private applySessionReplayToSdk(
		sessionReplay: boolean,
		analyticsEnabled = true,
	): void {
		if (this.posthog === null) return
		const off = this.recordingOff(sessionReplay, analyticsEnabled)
		if (off === this.recordingDisabled) return
		this.posthog.set_config({ disable_session_recording: off })
		this.recordingDisabled = off
	}

	/** True when nothing may be recorded now. */
	private recordingOff(
		sessionReplay: boolean,
		analyticsEnabled: boolean,
	): boolean {
		return (
			!(analyticsEnabled && sessionReplay) ||
			isUnrecordedPath(window.location.pathname)
		)
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
	 * Disposes the event subscriptions. AnalyticsService is a singleton and
	 * lives for the full page lifetime, so production code never calls this;
	 * tests use it to release the IEventAggregator subscriptions.
	 */
	public dispose(): void {
		this.consentSubscription.dispose()
		this.signedOutSubscription.dispose()
		this.authStartedSubscription.dispose()
		this.navigationSubscription.dispose()
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
		// Finish an idle-sliced replay of the pre-init queue synchronously.
		for (const entry of this.queue.splice(0, this.queue.length)) {
			this.replay(entry)
		}
		this.flushing = false
	}
}

// Re-export the catalogue for ergonomic single-import consumption at
// instrumented call sites.
export { Events }
