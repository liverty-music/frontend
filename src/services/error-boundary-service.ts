import { DI, ILogger, observable, resolve } from 'aurelia'

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

	constructor(error: unknown, context = 'unknown') {
		const uuid =
			typeof crypto?.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
		this.id = `ERR-${uuid.slice(0, 8)}`
		this.timestamp = new Date()
		this.context = context
		this.routeUrl = window.location.pathname

		if (error instanceof Error) {
			this.message = error.message
			this.stack = error.stack ?? ''
		} else {
			this.message = String(error)
			this.stack = ''
		}
	}
}

/**
 * Breadcrumb entry tracking user interactions for error context.
 */
interface Breadcrumb {
	type: 'click' | 'navigation' | 'rpc' | 'custom'
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

	private static readonly MAX_HISTORY = 20
	private static readonly MAX_BREADCRUMBS = 30
	private static readonly MAX_URL_LENGTH = 4096

	@observable
	public currentError: AppError | null = null

	public readonly errorHistory: AppError[] = []
	public readonly breadcrumbs: Breadcrumb[] = []

	/**
	 * Capture an error with optional source context.
	 */
	public captureError(error: unknown, context?: string): void {
		const appError = new AppError(error, context)
		this.currentError = appError

		this.errorHistory.push(appError)
		if (this.errorHistory.length > ErrorBoundaryService.MAX_HISTORY) {
			this.errorHistory.shift()
		}

		this.logger.error(`[${appError.id}] ${appError.message}`, {
			context: appError.context,
			route: appError.routeUrl,
		})
	}

	/**
	 * Dismiss the current error banner.
	 */
	public dismiss(): void {
		this.currentError = null
	}

	/**
	 * Record a breadcrumb for user interaction tracking.
	 */
	public addBreadcrumb(type: Breadcrumb['type'], label: string): void {
		this.breadcrumbs.push({
			type,
			label,
			timestamp: new Date(),
			route: window.location.pathname,
		})
		if (this.breadcrumbs.length > ErrorBoundaryService.MAX_BREADCRUMBS) {
			this.breadcrumbs.shift()
		}
	}

	/**
	 * Generate a Markdown-formatted error report suitable for GitHub Issues.
	 * Redacts Authorization headers, Bearer tokens, and OIDC parameters.
	 */
	public generateReport(appError: AppError): string {
		const breadcrumbLines = this.breadcrumbs
			.slice(-10)
			.map(
				(b) =>
					`- [${b.timestamp.toISOString()}] ${b.type}: ${b.label} (${b.route})`,
			)
			.join('\n')

		const raw = `## Error Report

- **Error ID**: ${appError.id}
- **Time**: ${appError.timestamp.toISOString()}
- **URL**: ${appError.routeUrl}
- **User Agent**: ${navigator.userAgent}
- **Source**: ${appError.context}

### Message

${appError.message}

### Stack Trace

\`\`\`
${appError.stack}
\`\`\`

### Recent User Actions

${breadcrumbLines || '_No breadcrumbs recorded_'}
`
		return ErrorBoundaryService.sanitize(raw)
	}

	/**
	 * Build a GitHub Issue URL with pre-filled title and body.
	 * Truncates the body to keep the URL under MAX_URL_LENGTH.
	 */
	public buildGitHubIssueUrl(appError: AppError): string {
		const title = `[${appError.id}] ${appError.message.slice(0, 80)}`
		let body = this.generateReport(appError)

		const baseUrl = 'https://github.com/liverty-music/frontend/issues/new?'
		const maxBodyLength =
			ErrorBoundaryService.MAX_URL_LENGTH -
			baseUrl.length -
			new URLSearchParams({ title, labels: 'bug', body: '' }).toString().length

		if (body.length > maxBodyLength) {
			body = `${body.slice(0, maxBodyLength - 40)}\n\n_(truncated — use "Copy Details" for full report)_`
		}

		const params = new URLSearchParams({
			title,
			body,
			labels: 'bug',
		})

		return `${baseUrl}${params.toString()}`
	}

	/**
	 * Strip sensitive tokens and auth parameters from report text.
	 */
	private static sanitize(text: string): string {
		return text
			.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]')
			.replace(
				/eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/g,
				'[JWT_REDACTED]',
			)
			.replace(
				/[?&](code|state|id_token|access_token|refresh_token)=[^&\s)]*/g,
				(_, key) => `${key}=[REDACTED]`,
			)
	}
}
