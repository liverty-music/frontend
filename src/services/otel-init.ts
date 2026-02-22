import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
	BatchSpanProcessor,
	WebTracerProvider,
} from '@opentelemetry/sdk-trace-web'
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

const OTEL_EXPORTER_URL =
	import.meta.env.VITE_OTEL_EXPORTER_URL ?? 'http://localhost:4318/v1/traces'

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

/**
 * Initialize OpenTelemetry browser SDK with OTLP/HTTP exporter
 * and automatic fetch instrumentation for traceparent propagation.
 */
export function initOtel(): WebTracerProvider {
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: 'liverty-music-frontend',
		[ATTR_SERVICE_VERSION]: '0.1.0',
	})

	const exporter = new OTLPTraceExporter({
		url: OTEL_EXPORTER_URL,
	})

	const provider = new WebTracerProvider({
		resource,
		spanProcessors: [new BatchSpanProcessor(exporter)],
	})

	provider.register()

	// Auto-instrument fetch requests and propagate traceparent to backend
	registerInstrumentations({
		instrumentations: [
			new FetchInstrumentation({
				propagateTraceHeaderCorsUrls: [new RegExp(escapeRegExp(API_BASE_URL))],
			}),
		],
	})

	return provider
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
