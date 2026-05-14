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
				// Skip the OIDC provider entirely — Zitadel's CORS preflight
				// rejects requests that include `traceparent` in the
				// `Access-Control-Request-Headers` list (the preflight 204
				// comes back WITHOUT `Access-Control-Allow-Origin`, blocking
				// the actual `/.well-known/openid-configuration` fetch).
				// Listing both the legacy Cloud host and the self-hosted
				// `auth.*.liverty-music.app` hosts keeps this resilient
				// across env (dev/staging/prod) and the never-merged rollback.
				ignoreUrls: [
					/zitadel\.cloud/,
					/^https:\/\/auth\..*\.liverty-music\.app/,
				],
			}),
		],
	})

	return provider
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
