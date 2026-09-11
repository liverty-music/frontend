/**
 * In-memory recorder for client-observed Connect-RPC call telemetry.
 *
 * The frontend exports no OpenTelemetry spans, so the client-observed RPC call
 * duration — including the auth silent-refresh + transient-retry recovery tail
 * that the shared client deadline bounds — is otherwise invisible in
 * production. This recorder accumulates every terminal RPC into a bucketed
 * latency histogram plus per-outcome and per-method tallies, so a downstream
 * flush can emit a small aggregate snapshot (percentiles computed at query
 * time) rather than one event per call. See the `frontend-client-rpc-telemetry`
 * capability spec.
 *
 * Pure and DOM-free: no timers, no network, no DI. The owning
 * {@link ../../services/rpc-telemetry-service RpcTelemetryService} handles the
 * opt-out / nil-config gate, the flush cadence, and delivery.
 */

import { Code, ConnectError } from '@connectrpc/connect'

/** Terminal outcome of an RPC call, from the client's perspective. */
export type RpcOutcome = 'ok' | 'deadline_exceeded' | 'canceled' | 'error'

/** A sink that receives one terminal RPC measurement. */
export type RpcTelemetrySink = (
	method: string,
	durationMs: number,
	outcome: RpcOutcome,
) => void

/**
 * Module-level seam between the shared transport and the telemetry service.
 *
 * The transport records via {@link recordRpcCall}; it must NOT depend on the
 * analytics/DI graph (dragging AnalyticsService — and its IEventAggregator /
 * consent deps — into every RPC client's dependency graph over-couples them and
 * breaks minimally-stubbed unit tests). The DI-owned RpcTelemetryService
 * installs itself as the sink once at boot via {@link setRpcTelemetrySink}, and
 * clears it on dispose. Until a sink is installed, recording is a no-op.
 */
let telemetrySink: RpcTelemetrySink | null = null

/** Installs (or clears, with `null`) the sink the transport records into. */
export function setRpcTelemetrySink(sink: RpcTelemetrySink | null): void {
	telemetrySink = sink
}

/** Records one terminal RPC call to the installed sink; no-op when unset. */
export function recordRpcCall(
	method: string,
	durationMs: number,
	outcome: RpcOutcome,
): void {
	telemetrySink?.(method, durationMs, outcome)
}

/**
 * Latency bucket upper bounds (ms), sized around the 10 s client deadline: fine
 * resolution for the sub-second common case, then coarser bands up to and
 * across 10 s so both normal ops and the near-/over-deadline tail stay legible.
 * A duration lands in the first bucket whose bound it does not exceed; anything
 * larger than the last bound counts as `overflow` (directly surfacing deadline
 * pressure). The set is fixed so fleet-wide percentiles reconstruct at query
 * time.
 */
export const RPC_LATENCY_BUCKET_BOUNDS_MS = [
	50, 100, 250, 500, 1000, 2000, 3000, 5000, 8000, 10_000, 15_000,
] as const

/** The aggregate snapshot for one reporting window. */
export interface RpcTelemetrySnapshot {
	/** Wall-clock span of the window in ms (window start → drain). */
	windowMs: number
	/** Total calls recorded in the window. */
	total: number
	/** Per-terminal-outcome counts. */
	outcomes: Record<RpcOutcome, number>
	/**
	 * Bucket upper-bound (ms, as a string key) → count, for non-empty buckets
	 * only; the `overflow` key counts calls slower than the largest bound.
	 * Preserves the distribution so p95/p99 are computed at query time.
	 */
	buckets: Record<string, number>
	/** Method identity → `[total, deadlineExceeded]` — compact per-method tally. */
	methods: Record<string, [number, number]>
}

/**
 * Classifies an RPC rejection into an {@link RpcOutcome}. A client-deadline
 * abort surfaces as `DeadlineExceeded`; an intentional cancellation
 * (navigation/unmount) as `Canceled` — kept distinct from the deadline so it
 * does not inflate the deadline-firing rate; everything else is `error`.
 */
export function classifyRpcOutcome(err: unknown): RpcOutcome {
	if (err instanceof DOMException && err.name === 'AbortError')
		return 'canceled'
	if (err instanceof ConnectError) {
		if (err.code === Code.Canceled) return 'canceled'
		if (err.code === Code.DeadlineExceeded) return 'deadline_exceeded'
	}
	return 'error'
}

/**
 * Accumulates RPC durations + outcomes into a histogram for the current window.
 * `record()` is O(1); `drain()` returns the window aggregate and resets.
 */
export class RpcTelemetryRecorder {
	private total = 0
	private readonly outcomes: Record<RpcOutcome, number> = {
		ok: 0,
		deadline_exceeded: 0,
		canceled: 0,
		error: 0,
	}
	/** One counter per bucket bound, plus a trailing overflow counter. */
	private readonly buckets: number[] = new Array(
		RPC_LATENCY_BUCKET_BOUNDS_MS.length + 1,
	).fill(0)
	private readonly methods = new Map<string, [number, number]>()
	private windowStartMs: number

	/** `now` is injectable so tests can control the window duration. */
	constructor(private readonly now: () => number = () => performance.now()) {
		this.windowStartMs = now()
	}

	/** Records one terminal RPC call into the current window. */
	record(method: string, durationMs: number, outcome: RpcOutcome): void {
		this.total++
		this.outcomes[outcome]++
		this.buckets[this.bucketIndexFor(durationMs)]++
		const tally = this.methods.get(method) ?? [0, 0]
		tally[0]++
		if (outcome === 'deadline_exceeded') tally[1]++
		this.methods.set(method, tally)
	}

	/** True when there is at least one recorded call awaiting a flush. */
	get pending(): boolean {
		return this.total > 0
	}

	/**
	 * Returns the current window aggregate and resets to an empty window, or
	 * `null` when nothing has been recorded (so the caller emits no report).
	 */
	drain(): RpcTelemetrySnapshot | null {
		const nowMs = this.now()
		if (this.total === 0) {
			this.windowStartMs = nowMs
			return null
		}
		const snapshot: RpcTelemetrySnapshot = {
			windowMs: Math.round(nowMs - this.windowStartMs),
			total: this.total,
			outcomes: { ...this.outcomes },
			buckets: this.bucketsToObject(),
			methods: Object.fromEntries(this.methods),
		}
		this.reset(nowMs)
		return snapshot
	}

	private bucketIndexFor(durationMs: number): number {
		for (let i = 0; i < RPC_LATENCY_BUCKET_BOUNDS_MS.length; i++) {
			if (durationMs <= RPC_LATENCY_BUCKET_BOUNDS_MS[i]) return i
		}
		return RPC_LATENCY_BUCKET_BOUNDS_MS.length // overflow
	}

	private bucketsToObject(): Record<string, number> {
		const obj: Record<string, number> = {}
		for (let i = 0; i < RPC_LATENCY_BUCKET_BOUNDS_MS.length; i++) {
			if (this.buckets[i] > 0) {
				obj[String(RPC_LATENCY_BUCKET_BOUNDS_MS[i])] = this.buckets[i]
			}
		}
		const overflow = this.buckets[RPC_LATENCY_BUCKET_BOUNDS_MS.length]
		if (overflow > 0) obj.overflow = overflow
		return obj
	}

	private reset(nowMs: number): void {
		this.total = 0
		this.outcomes.ok = 0
		this.outcomes.deadline_exceeded = 0
		this.outcomes.canceled = 0
		this.outcomes.error = 0
		this.buckets.fill(0)
		this.methods.clear()
		this.windowStartMs = nowMs
	}
}
