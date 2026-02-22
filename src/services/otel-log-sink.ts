import type { ILogEvent, ISink } from '@aurelia/kernel'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { LogLevel } from 'aurelia'

const tracer = trace.getTracer('aurelia-logger')

/**
 * Aurelia ISink implementation that creates OTEL spans for error/fatal log events.
 * Records the logger scope, severity, message, and exception details as span attributes.
 */
export class OtelLogSink implements ISink {
	public handleEvent(event: ILogEvent): void {
		// Only create spans for error and fatal severity
		if (event.severity < LogLevel.error) {
			return
		}

		const scope = event.scope.join('.')
		const spanName = `log.${event.severity === LogLevel.fatal ? 'fatal' : 'error'}`

		const span = tracer.startSpan(spanName)
		span.setAttributes({
			'log.scope': scope,
			'log.severity': LogLevel[event.severity] ?? String(event.severity),
			'log.message':
				event.message instanceof Error
					? event.message.message
					: String(event.message),
		})

		if (event.message instanceof Error) {
			span.recordException(event.message)
		}

		span.setStatus({
			code: SpanStatusCode.ERROR,
			message:
				event.message instanceof Error
					? event.message.message
					: String(event.message),
		})
		span.end()
	}
}
