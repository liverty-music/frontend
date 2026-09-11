import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../config/app-config'
import { IAnalyticsService } from '../lib/analytics/analytics-service'
import {
	type RpcOutcome,
	RpcTelemetryRecorder,
	setRpcTelemetrySink,
} from '../lib/analytics/rpc-telemetry'
import { IConsentService } from '../lib/consent/consent-service'
import { Events } from './analytics-events'

/**
 * Records client-observed RPC calls (via the shared transport) and periodically
 * flushes a single aggregate snapshot through the analytics pipeline. The
 * transport interceptor calls {@link record}; the service owns the histogram,
 * the opt-out / nil-config gate, and the flush cadence.
 */
export interface IRpcTelemetry {
	/**
	 * Records one terminal RPC call. A strict no-op when analytics is opted out
	 * or unconfigured — nothing is collected in those states.
	 */
	record(method: string, durationMs: number, outcome: RpcOutcome): void
}

export const IRpcTelemetry = DI.createInterface<IRpcTelemetry>(
	'IRpcTelemetry',
	(x) => x.singleton(RpcTelemetryService),
)

/**
 * Periodic flush cadence. A window is also flushed on page-hide, so this only
 * bounds how stale an in-memory aggregate can get for a long-lived tab; it is
 * intentionally coarse (this is a review signal, not real-time alerting).
 */
const FLUSH_INTERVAL_MS = 60_000

/**
 * Owns the {@link RpcTelemetryRecorder} and reports its aggregates as the
 * `perf.rpc_call_telemetry` analytics event — a few events per session, never
 * one per RPC. Collection and reporting are gated on the same analytics
 * opt-out / nil-config posture as the rest of analytics, so an opted-out or
 * unconfigured session emits (and collects) nothing. Percentiles (incl. the
 * auth-retry tail) and the `DeadlineExceeded` rate are computed at query time
 * from the shipped bucket distribution.
 */
export class RpcTelemetryService implements IRpcTelemetry {
	private readonly logger = resolve(ILogger).scopeTo('RpcTelemetry')
	private readonly config = resolve(IAppConfig)
	private readonly consent = resolve(IConsentService)
	private readonly analytics = resolve(IAnalyticsService)
	private readonly recorder = new RpcTelemetryRecorder()

	private readonly intervalId: ReturnType<typeof setInterval> | null = null
	private readonly onVisibilityChange = (): void => {
		if (globalThis.document?.visibilityState === 'hidden') this.flush()
	}
	private readonly onPageHide = (): void => this.flush()

	public constructor() {
		// Install the transport recording seam (decoupled from the analytics DI
		// graph — see rpc-telemetry.ts). One instance owns the sink for the page.
		setRpcTelemetrySink((method, durationMs, outcome) =>
			this.record(method, durationMs, outcome),
		)
		// Page-lifetime singleton: a periodic flush bounds staleness for a
		// long-lived tab, and the hide/pagehide flush covers short sessions and
		// the final window before teardown (analytics delivery survives unload).
		this.intervalId = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
		globalThis.document?.addEventListener(
			'visibilitychange',
			this.onVisibilityChange,
		)
		globalThis.addEventListener?.('pagehide', this.onPageHide)
	}

	public record(method: string, durationMs: number, outcome: RpcOutcome): void {
		// Strict no-op when opted out / unconfigured: collect nothing.
		if (!this.isCollecting()) return
		this.recorder.record(method, durationMs, outcome)
	}

	/** Nil-config + opt-out gate, mirroring AnalyticsService's posture. */
	private isCollecting(): boolean {
		return Boolean(this.config.posthogProjectKey) && this.consent.analytics
	}

	/**
	 * Drains the current window and, when there is data and analytics is still
	 * enabled, emits one aggregate event. A window collected before a mid-window
	 * opt-out is drained and dropped (never emitted).
	 */
	private flush(): void {
		const snapshot = this.recorder.drain()
		if (snapshot === null) return
		if (!this.isCollecting()) return
		this.analytics.capture(Events.RpcCallTelemetry, {
			window_ms: snapshot.windowMs,
			total: snapshot.total,
			ok: snapshot.outcomes.ok,
			deadline_exceeded: snapshot.outcomes.deadline_exceeded,
			canceled: snapshot.outcomes.canceled,
			error: snapshot.outcomes.error,
			buckets: snapshot.buckets,
			methods: snapshot.methods,
		})
		this.logger.debug('flushed RPC telemetry window', {
			total: snapshot.total,
			deadline_exceeded: snapshot.outcomes.deadline_exceeded,
		})
	}

	/**
	 * Releases the timer and listeners. AnalyticsService-style singleton: lives
	 * for the page lifetime, so production never calls this; tests use it to
	 * stop the interval and detach listeners.
	 */
	public dispose(): void {
		setRpcTelemetrySink(null)
		if (this.intervalId !== null) clearInterval(this.intervalId)
		globalThis.document?.removeEventListener(
			'visibilitychange',
			this.onVisibilityChange,
		)
		globalThis.removeEventListener?.('pagehide', this.onPageHide)
	}
}
