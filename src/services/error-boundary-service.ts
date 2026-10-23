import { I18N } from '@aurelia/i18n'
import { DI, ILogger, observable, resolve } from 'aurelia'
import { IAnalyticsService } from '../lib/analytics/analytics-service'
import { redactSecrets } from '../lib/analytics/redact-secrets'
import { rpcSpanOf, setRpcFailureStepSink } from './rpc-failure-trace'

/** The contact address the terms of service publish. */
export const REPORT_EMAIL_ADDRESS = 'pannpers@pannpers.dev'

/**
 * Structured error representation with unique ID and contextual metadata.
 */
export class AppError {
	public readonly id: string
	public readonly message: string
	public readonly stack: string
	public readonly timestamp: Date
	public readonly context: string
	public readonly routeUrl: string

	/**
	 * Whether the error report reached the SDK's send queue. Set after
	 * construction, and again when a report queued before analytics loaded is
	 * accepted, so the banner switches to the sent copy.
	 */
	@observable public reported = false

	/** The trace ID of the failing RPC, when the error came from one. */
	public traceId: string | undefined

	constructor(error: unknown, context = 'unknown') {
		const uuid =
			typeof crypto?.randomUUID === 'function'
				? crypto.randomUUID()
				: // randomUUID needs a secure context; getRandomValues does not.
					Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
						b.toString(16).padStart(2, '0'),
					).join('')
		this.id = `ERR-${uuid.slice(0, 8)}`
		this.timestamp = new Date()
		this.context = context
		this.routeUrl = window.location.pathname

		if (error instanceof Error) {
			this.message = error.message
			this.stack = error.stack ?? ''
		} else if (error instanceof ErrorEvent) {
			// An unhandled error without an error object: keep its location.
			this.message = error.message
			this.stack = error.filename
				? `at ${error.filename}:${error.lineno}:${error.colno}`
				: ''
		} else {
			this.message = describe(error)
			this.stack = ''
		}
	}
}

/** A readable form of a thrown or rejected value that is not an Error. */
function describe(value: unknown): string {
	if (typeof value === 'object' && value !== null) {
		try {
			return JSON.stringify(value)
		} catch {
			// Fall through: a cyclic object has no JSON form.
		}
	}
	return String(value)
}

/**
 * Step recorded before an error, attached to the error report. Labels are
 * a screen name, `<Service>/<Method> <Code>` or an action name: never text
 * the fan typed, an id or a query string (OpenSpec `global/error-banner`).
 */
interface Breadcrumb {
	type: 'navigation' | 'rpc' | 'action'
	label: string
	timestamp: Date
	route: string
}

export const IErrorBoundaryService = DI.createInterface<IErrorBoundaryService>(
	'IErrorBoundaryService',
	(x) => x.singleton(ErrorBoundaryService),
)

export interface IErrorBoundaryService extends ErrorBoundaryService {}

export class ErrorBoundaryService {
	private readonly logger = resolve(ILogger).scopeTo('ErrorBoundaryService')
	private readonly analytics = resolve(IAnalyticsService)
	private readonly i18n = resolve(I18N)

	private static readonly MAX_HISTORY = 20
	private static readonly MAX_BREADCRUMBS = 30
	private static readonly MAX_MAILTO_LENGTH = 2000
	private static readonly MAX_EMAIL_MESSAGE_LENGTH = 200
	private static readonly REOPEN_COOLDOWN_MS = 60_000

	@observable
	public currentError: AppError | null = null

	public readonly errorHistory: AppError[] = []
	public readonly breadcrumbs: Breadcrumb[] = []

	/** The error the fan last closed the banner for, and when. */
	private dismissed: { key: string; at: number } | null = null

	public constructor() {
		setRpcFailureStepSink((label) => this.addBreadcrumb('rpc', label))
	}

	/**
	 * Capture an error with optional source context, report it to the team
	 * and open the banner. A repeat of the open banner's error, or of an error
	 * whose banner the fan closed less than a minute ago, is stored and
	 * reported but does not change the banner.
	 */
	public captureError(error: unknown, context?: string): void {
		const appError = new AppError(error, context)

		this.errorHistory.push(appError)
		if (this.errorHistory.length > ErrorBoundaryService.MAX_HISTORY) {
			this.errorHistory.shift()
		}

		this.logger.error(`[${appError.id}] ${appError.message}`, {
			context: appError.context,
			route: appError.routeUrl,
		})

		this.report(error, appError)

		const key = ErrorBoundaryService.keyOf(appError)
		const open = this.currentError
		if (open !== null && ErrorBoundaryService.keyOf(open) === key) return
		if (
			open === null &&
			this.dismissed?.key === key &&
			Date.now() - this.dismissed.at < ErrorBoundaryService.REOPEN_COOLDOWN_MS
		) {
			return
		}
		this.currentError = appError
	}

	/**
	 * Dismiss the current error banner.
	 */
	public dismiss(): void {
		if (this.currentError !== null) {
			this.dismissed = {
				key: ErrorBoundaryService.keyOf(this.currentError),
				at: Date.now(),
			}
		}
		this.currentError = null
	}

	/**
	 * Record a step for the error report: a screen the fan moved to, a failed
	 * request, or a key action.
	 */
	public addBreadcrumb(type: Breadcrumb['type'], label: string): void {
		const route = window.location.pathname
		this.breadcrumbs.push({ type, label, timestamp: new Date(), route })
		if (this.breadcrumbs.length > ErrorBoundaryService.MAX_BREADCRUMBS) {
			this.breadcrumbs.shift()
		}
		// The report gets the type only: the route path can hold an id
		// (`/events/<id>`), and the report carries its own current address.
		this.analytics.addExceptionStep(label, { type })
	}

	/**
	 * Build the `mailto:` link of the report email: the inquiry number, time
	 * and screen, plus the investigation details when the error was not
	 * reported. Encoded with `encodeURIComponent` (spaces as `%20`, which mail
	 * apps show correctly) and kept within MAX_MAILTO_LENGTH, which some mail
	 * apps refuse to exceed, by shortening the error message.
	 */
	public buildReportMailto(appError: AppError): string {
		const t = (key: string, options?: Record<string, unknown>): string =>
			this.i18n.tr(`errorReportEmail.${key}`, options)
		const subject = t('subject', { errorId: appError.id })
		const time = new Intl.DateTimeFormat(this.i18n.getLocale(), {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZoneName: 'short',
		}).format(appError.timestamp)
		const lines = [
			t('hint'),
			t('example'),
			'',
			'',
			'',
			'---',
			t('keepBelow'),
			t('errorId', { value: appError.id }),
			t('time', { value: time }),
			t('screen', { value: appError.routeUrl }),
		]
		const build = (message: string): string => {
			const body = appError.reported
				? lines
				: [
						...lines,
						'',
						t('investigation'),
						t('errorMessage', { value: message }),
						...(appError.traceId
							? [t('traceId', { value: appError.traceId })]
							: []),
					]
			return `mailto:${REPORT_EMAIL_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.join('\r\n'))}`
		}

		let message = redactSecrets(appError.message).slice(
			0,
			ErrorBoundaryService.MAX_EMAIL_MESSAGE_LENGTH,
		)
		let link = build(message)
		while (
			link.length > ErrorBoundaryService.MAX_MAILTO_LENGTH &&
			message.length > 0
		) {
			// An encoded character takes 1 to 9 characters; shorten by the
			// smallest amount that could fit, then measure again.
			const excess = link.length - ErrorBoundaryService.MAX_MAILTO_LENGTH
			message = message.slice(0, -Math.max(1, Math.floor(excess / 9)))
			link = build(message)
		}
		return link
	}

	/**
	 * Send the error report. Reporting never throws and never stops the
	 * banner from opening; a failure leaves `reported` false.
	 */
	private report(error: unknown, appError: AppError): void {
		try {
			const cause = (error as { cause?: unknown } | null)?.cause
			const span = rpcSpanOf(error) ?? rpcSpanOf(cause)
			appError.traceId = span?.traceId
			const props: Record<string, unknown> = {
				error_id: appError.id,
				error_source: appError.context,
				// The referral code itself never leaves the device; the report
				// says only whether one was present (OpenSpec `global/analytics`).
				has_ref: new URLSearchParams(window.location.search).has('ref'),
			}
			if (span !== undefined) {
				props.$trace_id = span.traceId
				props.$span_id = span.spanId
			}
			appError.reported = this.analytics.captureException(error, props, () => {
				appError.reported = true
			})
		} catch (err) {
			this.logger.warn('Error report failed', { error: err })
		}
	}

	/** Errors with the same source and message count as repeats. */
	private static keyOf(appError: AppError): string {
		return `${appError.context}\u0000${appError.message}`
	}
}
