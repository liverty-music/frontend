import { I18N } from '@aurelia/i18n'
import { DI, ILogger, Registration } from 'aurelia'
import { buildErrorPropertiesBuilder } from 'posthog-js/lib/src/posthog-exceptions'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import { filterAnalyticsEvent } from '../../src/lib/analytics/error-report-filter'
import {
	AppError,
	ErrorBoundaryService,
	IErrorBoundaryService,
} from '../../src/services/error-boundary-service'
import {
	recordRpcFailureStep,
	rememberRpcSpan,
	setRpcFailureStepSink,
} from '../../src/services/rpc-failure-trace'
import { createCatalogI18n } from '../helpers/catalog-i18n'
import { createMockLogger } from '../helpers/mock-logger'

const BANNER_SPEC = 'components/infrastructure/fan/web/global/error-banner'

describe('AppError', () => {
	it('should create an error from an Error instance', () => {
		const err = new Error('test error')
		const appError = new AppError(err, 'TestContext')

		expect(appError.message).toBe('test error')
		expect(appError.context).toBe('TestContext')
		expect(appError.id).toMatch(/^ERR-/)
		expect(appError.timestamp).toBeInstanceOf(Date)
		expect(appError.stack).toBeTruthy()
		expect(appError.reported).toBe(false)
	})

	it('should create an error from a non-Error value', () => {
		const appError = new AppError('string error')

		expect(appError.message).toBe('string error')
		expect(appError.stack).toBe('')
		expect(appError.context).toBe('unknown')
	})

	it('should describe a plain object by its JSON form', () => {
		expect(new AppError({ code: 3 }).message).toBe('{"code":3}')
	})

	it('should build the id from getRandomValues outside a secure context', () => {
		// randomUUID is absent outside a secure context (plain-HTTP origins).
		vi.stubGlobal('crypto', {
			getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab),
		})
		try {
			expect(new AppError('x').id).toBe('ERR-abababab')
		} finally {
			vi.unstubAllGlobals()
		}
	})
})

describe('ErrorBoundaryService', () => {
	let sut: ErrorBoundaryService
	let analytics: {
		captureException: ReturnType<typeof vi.fn>
		addExceptionStep: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		analytics = {
			captureException: vi.fn().mockReturnValue(true),
			addExceptionStep: vi.fn(),
		}
		// Not createTestContainer: its I18N mock would win over the catalog one.
		const container = DI.createContainer()
		container.register(
			Registration.instance(ILogger, createMockLogger()),
			Registration.instance(IAnalyticsService, analytics),
			Registration.instance(I18N, createCatalogI18n()),
			ErrorBoundaryService,
		)
		sut = container.get(IErrorBoundaryService)
	})

	afterEach(() => {
		setRpcFailureStepSink(null)
		window.history.replaceState(null, '', '/')
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('captureError', () => {
		it(`@spec ${BANNER_SPEC} "Capture error adds to history"`, () => {
			sut.captureError(new Error('e1'))
			sut.captureError(new Error('e2'))

			expect(sut.errorHistory).toHaveLength(2)
			expect(sut.currentError?.message).toBe('e2')
		})

		it(`@spec ${BANNER_SPEC} "History is capped"`, () => {
			for (let i = 0; i < 25; i++) {
				sut.captureError(new Error(`error ${i}`))
			}

			expect(sut.errorHistory).toHaveLength(20)
			// The first 5 should have been shifted out
			expect(sut.errorHistory[0].message).toBe('error 5')
		})

		it(`@spec ${BANNER_SPEC} "Error is captured with context"`, () => {
			window.history.replaceState(null, '', '/dashboard?artists=a1')

			sut.captureError(new Error('test'), 'ctx')

			const current = sut.currentError
			expect(current).toMatchObject({
				message: 'test',
				context: 'ctx',
				routeUrl: '/dashboard',
			})
			expect(current?.id).toMatch(/^ERR-/)
			expect(current?.stack).toContain('Error: test')
			expect(current?.timestamp).toBeInstanceOf(Date)
			expect(sut.errorHistory).toEqual([current])
		})

		it(`@spec ${BANNER_SPEC} "Same error does not replace the open banner"`, () => {
			sut.captureError(new Error('same'), 'unhandled_error')
			const first = sut.currentError?.id

			sut.captureError(new Error('same'), 'unhandled_error')

			expect(sut.currentError?.id).toBe(first)
			expect(sut.errorHistory).toHaveLength(2)
			expect(analytics.captureException).toHaveBeenCalledTimes(2)
		})

		it(`@spec ${BANNER_SPEC} "Same error does not reopen a closed banner"`, () => {
			vi.useFakeTimers()
			sut.captureError(new Error('same'), 'unhandled_error')
			sut.dismiss()

			vi.advanceTimersByTime(59_000)
			sut.captureError(new Error('same'), 'unhandled_error')

			expect(sut.currentError).toBeNull()
			expect(sut.errorHistory).toHaveLength(2)
			expect(analytics.captureException).toHaveBeenCalledTimes(2)

			// A different error, or the same one a minute later, opens it.
			sut.captureError(new Error('other'), 'unhandled_error')
			expect(sut.currentError?.message).toBe('other')
			sut.dismiss()
			vi.advanceTimersByTime(61_000)
			sut.captureError(new Error('other'), 'unhandled_error')
			expect(sut.currentError?.message).toBe('other')
		})
	})

	describe('error report', () => {
		it(`@spec ${BANNER_SPEC} "Error is reported with its Error ID and steps"`, () => {
			window.history.replaceState(null, '', '/dashboard')
			sut.addBreadcrumb('navigation', 'dashboard')
			window.history.replaceState(null, '', '/events/e-1')
			sut.addBreadcrumb('navigation', 'events/:id')
			const err = new Error('boom')

			sut.captureError(err, 'unhandled_error')

			expect(analytics.addExceptionStep.mock.calls).toEqual([
				// No route: a path such as /events/e-1 holds an id.
				['dashboard', { type: 'navigation' }],
				['events/:id', { type: 'navigation' }],
			])
			expect(analytics.captureException).toHaveBeenCalledOnce()
			const [value, props] = analytics.captureException.mock.calls[0]
			expect(value).toBe(err)
			expect(props).toEqual({
				error_id: sut.currentError?.id,
				error_source: 'unhandled_error',
				has_ref: false,
			})
			expect(sut.currentError?.reported).toBe(true)
		})

		it('states that a ref key was present without its value', () => {
			window.history.replaceState(null, '', '/events/e-1?ref=member-a')

			sut.captureError(new Error('boom'))

			const [, props] = analytics.captureException.mock.calls[0]
			expect(props.has_ref).toBe(true)
			expect(JSON.stringify(props)).not.toContain('member-a')
		})

		it(`@spec ${BANNER_SPEC} "Failed request carries its trace ID"`, () => {
			const err = new Error('internal')
			rememberRpcSpan(err, {
				traceId: '0af7651916cd43dd8448eb211c80319c',
				spanId: 'b7ad6b7169203331',
			})
			// The transport's step for the same failure.
			recordRpcFailureStep('ArtistService/Follow Internal')

			sut.captureError(err, 'unhandled_rejection')

			const [, props] = analytics.captureException.mock.calls[0]
			expect(props).toMatchObject({
				$trace_id: '0af7651916cd43dd8448eb211c80319c',
				$span_id: 'b7ad6b7169203331',
			})
			expect(sut.currentError?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
			expect(analytics.addExceptionStep).toHaveBeenCalledWith(
				'ArtistService/Follow Internal',
				{ type: 'rpc' },
			)
		})

		it('finds the trace ID on the cause of a wrapping error', () => {
			const rpcErr = new Error('internal')
			rememberRpcSpan(rpcErr, { traceId: 't-1', spanId: 's-1' })

			sut.captureError(new Error('load failed', { cause: rpcErr }))

			const [, props] = analytics.captureException.mock.calls[0]
			expect(props.$trace_id).toBe('t-1')
		})

		it(`@spec ${BANNER_SPEC} "Analytics off sends no report"`, () => {
			// AnalyticsService returns false and sends nothing when analytics is
			// off (analytics-service.spec "returns false and sends nothing when
			// analytics is off").
			analytics.captureException.mockReturnValue(false)

			sut.captureError(new Error('boom'), 'unhandled_error')

			expect(sut.currentError?.reported).toBe(false)
		})

		it(`@spec ${BANNER_SPEC} "Error with a cause"`, () => {
			const err = new Error('outer', { cause: new TypeError('inner') })

			sut.captureError(err)

			// The original value goes to the SDK, which walks the cause chain.
			const [value] = analytics.captureException.mock.calls[0]
			expect(value).toBe(err)
			const { $exception_list } =
				buildErrorPropertiesBuilder().buildFromUnknown(value, {
					mechanism: { handled: true },
				})
			expect($exception_list.map((e) => [e.type, e.value])).toEqual([
				['Error', 'outer'],
				['TypeError', 'inner'],
			])
		})

		it(`@spec ${BANNER_SPEC} "Rejection with a plain value"`, () => {
			sut.captureError({ code: 3 }, 'unhandled_rejection')

			const [value] = analytics.captureException.mock.calls[0]
			expect(value).toEqual({ code: 3 })
			const { $exception_list } =
				buildErrorPropertiesBuilder().buildFromUnknown(value, {
					mechanism: { handled: true },
				})
			expect(JSON.stringify($exception_list)).not.toContain('[object Object]')
			expect($exception_list[0].value).toContain('code')
		})

		it(`@spec ${BANNER_SPEC} "Tokens are redacted from the report"`, () => {
			const err = new Error(
				'Authorization: Bearer abc.def; id eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
			)
			sut.captureError(err)

			// What the SDK builds from that value, through the app's before_send.
			const [value] = analytics.captureException.mock.calls[0]
			const properties = buildErrorPropertiesBuilder().buildFromUnknown(value, {
				mechanism: { handled: true },
			})
			const sent = filterAnalyticsEvent(
				{ event: '$exception', properties },
				window.location.origin,
			)
			const reported = JSON.stringify(sent?.properties.$exception_list)
			expect(reported).toContain('Bearer [REDACTED]')
			expect(reported).toContain('[JWT_REDACTED]')
			expect(reported).not.toContain('abc.def')
		})

		it(`@spec ${BANNER_SPEC} "Reporting failure does not break the banner"`, () => {
			analytics.captureException.mockImplementation(() => {
				throw new Error('sdk')
			})

			expect(() => sut.captureError(new Error('boom'))).not.toThrow()

			expect(sut.currentError).not.toBeNull()
			expect(sut.currentError?.reported).toBe(false)
		})

		it(`@spec ${BANNER_SPEC} "Report accepted after the banner opened"`, () => {
			analytics.captureException.mockReturnValue(false)

			sut.captureError(new Error('early'))
			expect(sut.currentError?.reported).toBe(false)

			// AnalyticsService calls back once the queued report is accepted.
			const onAccepted = analytics.captureException.mock.calls[0][2]
			onAccepted()
			expect(sut.currentError?.reported).toBe(true)
		})
	})

	describe('dismiss', () => {
		it(`@spec ${BANNER_SPEC} "Dismiss clears current error"`, () => {
			sut.captureError(new Error('test'))
			expect(sut.currentError).not.toBeNull()

			sut.dismiss()
			expect(sut.currentError).toBeNull()
		})

		it(`@spec ${BANNER_SPEC} "User dismisses error"`, () => {
			sut.captureError(new Error('test'))
			const captured = sut.currentError

			sut.dismiss()

			expect(sut.currentError).toBeNull()
			expect(sut.errorHistory).toContain(captured)
		})
	})

	describe('addBreadcrumb', () => {
		it(`@spec ${BANNER_SPEC} "Breadcrumb tracking"`, () => {
			window.history.replaceState(null, '', '/dashboard')
			setRpcFailureStepSink(null)
			sut.addBreadcrumb('navigation', 'dashboard')
			sut.addBreadcrumb('rpc', 'ArtistService/Follow Internal')
			sut.addBreadcrumb('action', 'follow_artist')

			expect(sut.breadcrumbs.map((b) => [b.type, b.label, b.route])).toEqual([
				['navigation', 'dashboard', '/dashboard'],
				['rpc', 'ArtistService/Follow Internal', '/dashboard'],
				['action', 'follow_artist', '/dashboard'],
			])
			expect(sut.breadcrumbs[0].timestamp).toBeInstanceOf(Date)
			// Every step also goes to the error report.
			expect(analytics.addExceptionStep).toHaveBeenCalledTimes(3)

			for (let i = 0; i < 35; i++) {
				sut.addBreadcrumb('action', `action_${i}`)
			}
			expect(sut.breadcrumbs).toHaveLength(30)
			expect(sut.breadcrumbs[0].label).toBe('action_5')
		})
	})

	describe('buildReportMailto', () => {
		function parse(link: string) {
			const [address, query] = link.slice('mailto:'.length).split('?')
			const params = Object.fromEntries(
				query.split('&').map((pair) => {
					const [key, value] = pair.split('=')
					return [key, decodeURIComponent(value)]
				}),
			)
			return { address, subject: params.subject, body: params.body, query }
		}

		it(`@spec ${BANNER_SPEC} "Report email link is constructed correctly"`, () => {
			analytics.captureException.mockReturnValue(false)
			sut.captureError(new Error('x '.repeat(5_000)))
			const appError = sut.currentError as AppError

			const link = sut.buildReportMailto(appError)

			expect(link.startsWith('mailto:pannpers@pannpers.dev?')).toBe(true)
			expect(link.length).toBeLessThanOrEqual(2_000)
			const { subject, query } = parse(link)
			expect(subject).toContain(appError.id)
			expect(query).not.toContain('+')
			expect(query).toContain('%20')
		})

		it('keeps a long Japanese message within 2,000 characters', () => {
			analytics.captureException.mockReturnValue(false)
			sut.captureError(new Error('読み込みに失敗しました'.repeat(100)))

			const link = sut.buildReportMailto(sut.currentError as AppError)

			expect(link.length).toBeLessThanOrEqual(2_000)
			expect(parse(link).body).toContain('エラー：読み込み')
		})

		it(`@spec ${BANNER_SPEC} "Sanitize redacts sensitive tokens"`, () => {
			analytics.captureException.mockReturnValue(false)
			sut.captureError(
				new Error(
					'Bearer abc.def at /callback?code=abc123 eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
				),
			)

			const { body } = parse(
				sut.buildReportMailto(sut.currentError as AppError),
			)

			expect(body).toContain('Bearer [REDACTED]')
			expect(body).toContain('[JWT_REDACTED]')
			expect(body).not.toContain('abc123')
			expect(body).not.toContain('abc.def')
		})

		it('lays out the hint, the inquiry number, the time and the screen', () => {
			window.history.replaceState(null, '', '/events/e-1?ref=member-a')
			sut.captureError(new Error('boom'))
			const appError = sut.currentError as AppError

			const { subject, body } = parse(sut.buildReportMailto(appError))

			expect(subject).toBe(
				`アプリがうまく動きませんでした（お問い合わせ番号：${appError.id}）`,
			)
			const lines = body.split('\r\n')
			expect(lines.slice(0, 7)).toEqual([
				'そのとき何をしていたか、ひとことお願いします。',
				'例：ライブの詳細を開こうとした',
				'',
				'',
				'',
				'---',
				'ここから下は、そのまま送ってください。',
			])
			expect(lines[7]).toBe(`お問い合わせ番号：${appError.id}`)
			expect(lines[8]).toMatch(/^日時：\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /)
			expect(lines[9]).toBe('画面：/events/e-1')
		})
	})
})
