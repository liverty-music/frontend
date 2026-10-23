/**
 * Module-level seam between the shared transport and the error report
 * (OpenSpec `global/error-banner`, design D6).
 *
 * The transport records the span of a failed RPC against the thrown error and
 * a failed-request step; the DI-owned ErrorBoundaryService reads the span when
 * the error reaches it and installs itself as the step sink at construction.
 * Like `setRpcTelemetrySink`, this keeps the transport free of the DI graph.
 */

/** The OTel IDs of a failed RPC's span, sent to the backend in `traceparent`. */
export interface SpanIds {
	traceId: string
	spanId: string
}

// A WeakMap rather than a property on the error: a frozen or foreign error
// still works, and nothing leaks into the error's serialisation.
const spans = new WeakMap<object, SpanIds>()

/** Records the span of the RPC that threw `err`. */
export function rememberRpcSpan(err: unknown, ids: SpanIds): void {
	if (typeof err === 'object' && err !== null) spans.set(err, ids)
}

/** The span of the RPC that threw `err`, if a transport call threw it. */
export function rpcSpanOf(err: unknown): SpanIds | undefined {
	return typeof err === 'object' && err !== null ? spans.get(err) : undefined
}

/** A sink that receives the label of one failed-request step. */
export type RpcFailureStepSink = (label: string) => void

let stepSink: RpcFailureStepSink | null = null

/** Installs (or clears, with `null`) the sink failed-request steps go to. */
export function setRpcFailureStepSink(sink: RpcFailureStepSink | null): void {
	stepSink = sink
}

/** Records a failed-request step `<Service>/<Method> <Code>`; no-op when unset. */
export function recordRpcFailureStep(label: string): void {
	stepSink?.(label)
}
