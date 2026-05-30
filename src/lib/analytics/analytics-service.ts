import { trace } from '@opentelemetry/api'
import { DI, ILogger, resolve } from 'aurelia'
import type { PostHog, PostHogConfig } from 'posthog-js'
import { IAppConfig } from '../../config/app-config'
import {
	type EventName,
	type EventProps,
	Events,
} from '../../services/analytics-events'
import { IConsentService } from '../consent/consent-service'

/**
 * Public surface for the typed PostHog wrapper. Every consumer (route VMs,
 * services, app-shell page-view wiring) MUST resolve through this interface
 * — the concrete class is registered as a singleton in `main.ts`. Keeping
 * the surface minimal protects call sites from PostHog SDK churn and makes
 * the nil-config / pre-init / pre-consent branches the *only* code paths
 * that ever observe the wrapped SDK directly.
 *
 * Owns the contract for the `introduce-analytics-tool` OpenSpec change
 * (Batch 3a). Consent UI lives in Batch 3b; per-event instrumentation in
 * Batch 3c.
 */
export interface IAnalyticsService {
	/**
	 * Typed event emission. The `name` literal pins the required
	 * property shape at compile time (see `analytics-events.ts` for the
	 * `EventName` → `EventProps<E>` mapping). Mismatched name/props pairs
	 * fail the typecheck.
	 *
	 * Behaviour matrix:
	 *   - nil-config (no `posthogProjectKey`): debug-log and return.
	 *   - pre-init: enqueue to a bounded in-memory buffer; flushed
	 *     verbatim on init.
	 *   - post-init: forward to PostHog with `trace_id` injected from
	 *     the active OTel span (best-effort).
	 *
	 * Consent gating does NOT block `capture` — PostHog runs in
	 * `persistence: 'memory'` until consent is granted, which is the
	 * privacy-equivalent posture (no persistent storage, no IP
	 * collection, anonymous distinct id). Only `identify` is hard-gated.
	 */
	capture<E extends EventName>(name: E, props: EventProps<E>): void

	/**
	 * Associates the current session with a real user id. Hard-gated on
	 * `IConsentService.analytics`; called from the (Batch 3c)
	 * `UserHydrationTask` integration after consent is confirmed.
	 * No-op when consent is denied OR when running in nil-config mode.
	 */
	identify(userId: string, properties?: Readonly<Record<string, unknown>>): void

	/**
	 * Clears the current identification (e.g. on sign-out). Forwards to
	 * `posthog.reset()` once initialised; also clears the pre-init queue
	 * so any buffered events captured under the prior identity are
	 * dropped. No-op in nil-config mode.
	 */
	reset(): void

	/**
	 * Returns the current value of a PostHog feature flag, or the
	 * supplied default when:
	 *   - The service is in nil-config mode (no `posthogProjectKey`).
	 *   - The SDK has not finished initialising yet (no value to read).
	 *   - PostHog returns `undefined` (flag is unknown to the project).
	 *
	 * Synchronous by design so callers (route guards, UI gates) do not
	 * need to await initialisation. Use the default to encode the
	 * fail-closed behaviour expected by the gate.
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
 * Upper bound on the pre-init queue. The deferred-init window is bounded
 * by `requestIdleCallback` firing (at most ~2s due to the explicit
 * timeout below), so realistic pre-init traffic is a handful of events —
 * the boot page-view plus whatever the welcome route emits. 100 leaves
 * comfortable headroom while preventing a runaway page from flooding
 * memory if init somehow stalls (e.g. the SDK dynamic import throws and
 * is retried by a misbehaving caller). Matches the cap defined in the
 * `introduce-analytics-tool` OpenSpec tasks.
 */
const PRE_INIT_QUEUE_LIMIT = 100

/**
 * Hard cap on how long the browser may defer the init callback. Without
 * a timeout, `requestIdleCallback` MAY never fire on a permanently busy
 * tab. 2 seconds is roughly the LCP budget for the dashboard, so deferring
 * past that point yields diminishing returns — we'd rather take the small
 * INP hit and start capturing events than block analytics indefinitely.
 */
const INIT_IDLE_TIMEOUT_MS = 2_000

export class AnalyticsService implements IAnalyticsService {
	private readonly logger = resolve(ILogger).scopeTo('AnalyticsService')
	private readonly config = resolve(IAppConfig)
	private readonly consent = resolve(IConsentService)

	/**
	 * Truthy iff PostHog initialisation has completed. Until this flips,
	 * `capture` enqueues; after it flips, `capture` forwards directly.
	 * Initialisation can fail (network, ad-blocker) — in that case
	 * `posthog` stays `null` and the service degrades to log-and-drop,
	 * matching the backend's nil-client posture so missing analytics
	 * never break the product surface.
	 */
	private posthog: PostHog | null = null
	private initStarted = false
	private readonly queue: QueuedCapture[] = []
	private queueOverflowed = false

	public constructor() {
		this.scheduleInit()
	}

	/**
	 * Public entry point — see `IAnalyticsService.capture` for the
	 * documented behaviour matrix. The runtime branching here MUST stay
	 * O(1): every call site emits at least one event per user action,
	 * and a measurable hit on INP would defeat the purpose.
	 */
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
		if (!this.consent.analytics) {
			this.logger.debug('identify suppressed (consent denied)', { userId })
			return
		}
		if (this.posthog === null) {
			// Pre-init identify is intentionally dropped rather than
			// queued: pairing it with the deferred-flush capture queue
			// would replay identifications out-of-order against later
			// reset() calls in the same boot, and the Batch 3c
			// UserHydrationTask integration explicitly runs `identify`
			// AFTER the SDK init is awaited, so this branch should not
			// be reachable in production. Log at debug so any
			// regression is visible during development.
			this.logger.debug('identify dropped (pre-init)', { userId })
			return
		}
		this.posthog.identify(userId, properties)
	}

	public reset(): void {
		if (!this.isEnabled()) {
			this.logger.debug('reset suppressed (nil-config mode)')
			return
		}
		// Clear any buffered events regardless of init state — they were
		// captured under the prior identity and forwarding them after a
		// reset would attribute pre-signout actions to the post-signout
		// anonymous id. Cheaper than walking the queue to filter.
		this.queue.length = 0
		this.queueOverflowed = false
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
	 * Schedules the actual SDK import + init for the next idle slot.
	 * Using `requestIdleCallback` keeps PostHog's dynamic import off the
	 * critical path so it cannot regress INP / LCP. Safari < 16 lacks
	 * `requestIdleCallback`; fall back to `setTimeout(0)` which still
	 * yields one task before init runs.
	 */
	private scheduleInit(): void {
		if (this.initStarted) return
		this.initStarted = true
		if (!this.isEnabled()) {
			// In nil-config mode we still flip initStarted so subsequent
			// constructor calls (test isolation) don't redundantly log.
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
	 * Loads the PostHog SDK dynamically (kept out of the main bundle)
	 * and initialises it with the privacy-default posture: in-memory
	 * persistence, no IP collection, anonymous distinct id. The Batch 3b
	 * consent-grant path will upgrade these settings (`set_config` plus
	 * `identify`) after the user opts in.
	 *
	 * Failure here is non-fatal — the catch path logs and leaves
	 * `posthog === null`, so subsequent captures fall back to the
	 * nil-config branch. We do NOT retry: a failed init usually means
	 * an ad-blocker or a tracking-protection extension is in play, and
	 * retry would only waste cycles.
	 */
	private async init(): Promise<void> {
		try {
			const module = await import('posthog-js')
			const posthog = module.default
			const apiHost =
				this.config.posthogApiHost && this.config.posthogApiHost.length > 0
					? this.config.posthogApiHost
					: 'https://eu.i.posthog.com'
			const initConfig: Partial<PostHogConfig> = {
				api_host: apiHost,
				// Pre-consent posture. `persistence: 'memory'` keeps the
				// session-scoped anonymous id off disk so refresh /
				// re-open generates a fresh id (the tracking-protection
				// equivalent of the backend's anonymous-by-default
				// stance). `ip: false` prevents PostHog from recording
				// the source IP for any event captured in this state.
				// `disable_persistence` is intentionally not used — the
				// Batch 3b consent-grant flow switches `persistence` to
				// `localStorage+cookie` via `set_config`, which the
				// `disable_persistence` flag would block.
				persistence: 'memory',
				ip: false,
				// Autocapture is disabled: every event in this app is
				// catalogued through `analytics-events.ts`. Implicit
				// captures would create rogue events outside the
				// catalogue and undermine the CI catalogue check
				// planned in the OpenSpec tasks.
				autocapture: false,
				// Identification and feature-flag bootstrap are
				// orchestrated by AnalyticsService itself (see
				// `identify`) rather than by SDK helpers, so the
				// session-recording defaults stay off until Batch 3b
				// wires the consent-aware initialisation block.
				capture_pageview: false,
				disable_session_recording: true,
				// Suppress PostHog's own console noise in dev — the
				// Aurelia logger pipeline owns telemetry-of-telemetry.
				loaded: () => {
					this.logger.debug('PostHog SDK loaded')
				},
			}
			posthog.init(this.config.posthogProjectKey, initConfig)
			this.posthog = posthog
			this.flushQueue()
		} catch (err) {
			this.logger.warn(
				'PostHog SDK failed to load; analytics disabled for this session',
				{ error: err },
			)
		}
	}

	private enqueue(entry: QueuedCapture): void {
		if (this.queue.length >= PRE_INIT_QUEUE_LIMIT) {
			// Log only once per session — a stuck init would otherwise
			// flood the logger with the same warn every capture.
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
	 * The single place that touches `posthog.capture`. Injects the
	 * active OTel `trace_id` so paired FE/BE events can be correlated in
	 * PostHog (matches the backend posthog adapter contract referenced
	 * in `analytics-events.ts`). The OTel browser SDK does not own a
	 * tracer here — spans come from the existing fetch instrumentation
	 * in `services/otel-init.ts` — so `getActiveSpan()` returns the
	 * caller's span only if the capture happens during a fetch handler.
	 * That is fine: server-paired events (e.g. `artist.follow.requested`
	 * → `artist.follow.completed`) are emitted from RPC call sites
	 * already wrapped by `FetchInstrumentation`, and standalone UI
	 * events (e.g. `page.viewed`) intentionally have no trace
	 * correlation.
	 */
	private dispatch<E extends EventName>(name: E, props: EventProps<E>): void {
		if (this.posthog === null) return
		const enriched: Record<string, unknown> = { ...props }
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
	 * @internal Test hook — awaits the queued init so specs don't have
	 *   to poll `requestIdleCallback` timing. Production code never
	 *   calls this; it is not part of `IAnalyticsService` and DI hands
	 *   callers the interface type only.
	 */
	public async _waitForInitForTests(): Promise<void> {
		// init() is queued via requestIdleCallback / setTimeout; flush
		// the microtask + macrotask queues by awaiting a 0-ms timeout,
		// then awaiting any in-flight init promise.
		await new Promise((r) => setTimeout(r, 0))
		// init() is fire-and-forget from scheduleInit; we re-issue it
		// synchronously here so the spec can await the resulting
		// promise deterministically.
		if (this.posthog === null && this.isEnabled()) {
			await this.init()
		}
	}
}

// Re-export the catalogue for ergonomic single-import consumption in
// instrumented call sites (Batch 3c). Keeps `import { Events,
// IAnalyticsService }` on one line at the use site.
export { Events }
