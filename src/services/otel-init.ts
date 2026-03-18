import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

const API_BASE_URL =
	import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

/**
 * Initialize OpenTelemetry browser SDK for traceparent propagation.
 * No spans are exported — the backend handles trace export to Cloud Trace.
 */
export function initOtel(): WebTracerProvider {
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: 'liverty-music-frontend',
		[ATTR_SERVICE_VERSION]: '0.1.0',
	})

	const provider = new WebTracerProvider({ resource })

	provider.register()

	// Auto-instrument fetch requests and propagate traceparent to backend
	registerInstrumentations({
		instrumentations: [
			new FetchInstrumentation({
				propagateTraceHeaderCorsUrls: [new RegExp(escapeRegExp(API_BASE_URL))],
				ignoreUrls: [/zitadel\.cloud/],
			}),
		],
	})

	return provider
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
