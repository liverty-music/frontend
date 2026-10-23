import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	CustomElement,
	DI,
	IEventAggregator,
	ILogger,
	IWindow,
	Registration,
} from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBanner } from '../../src/components/error-banner/error-banner'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import {
	ErrorBoundaryService,
	IErrorBoundaryService,
} from '../../src/services/error-boundary-service'
import { rememberRpcSpan } from '../../src/services/rpc-failure-trace'
import { createCatalogI18n } from '../helpers/catalog-i18n'
import { createMockLogger } from '../helpers/mock-logger'

const BANNER_SPEC = 'components/infrastructure/fan/web/global/error-banner'

/** The analytics surface ErrorBoundaryService reports through. */
function createMockAnalytics(reported: boolean) {
	return {
		captureException: vi.fn().mockReturnValue(reported),
		addExceptionStep: vi.fn(),
	}
}

/** The address, subject and body of a `mailto:` link. */
function parseMailto(link: string) {
	const [address, query] = link.slice('mailto:'.length).split('?')
	const params = new Map(
		query.split('&').map((pair) => {
			const [key, value] = pair.split('=')
			return [key, decodeURIComponent(value)] as const
		}),
	)
	return {
		address,
		subject: params.get('subject') ?? '',
		body: params.get('body') ?? '',
	}
}

describe('ErrorBanner', () => {
	let sut: ErrorBanner
	let boundary: ErrorBoundaryService
	let fakeWindow: {
		location: { href: string; reload: ReturnType<typeof vi.fn> }
	}
	let ea: { publish: ReturnType<typeof vi.fn> }

	function build(reported: boolean): void {
		fakeWindow = { location: { href: '', reload: vi.fn() } }
		ea = { publish: vi.fn() }
		const container = DI.createContainer()
		container.register(
			Registration.instance(ILogger, createMockLogger()),
			Registration.instance(I18N, createCatalogI18n()),
			Registration.instance(IAnalyticsService, createMockAnalytics(reported)),
			Registration.instance(IEventAggregator, ea),
			Registration.instance(IWindow, fakeWindow),
			Registration.singleton(IErrorBoundaryService, ErrorBoundaryService),
			ErrorBanner,
		)
		boundary = container.get(IErrorBoundaryService)
		sut = container.get(ErrorBanner)
	}

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('dismiss delegates to errorBoundary.dismiss()', () => {
		build(true)
		boundary.captureError(new Error('fail'))

		sut.dismiss()

		expect(boundary.currentError).toBeNull()
	})

	it(`@spec ${BANNER_SPEC} "Email report opens a pre-filled message"`, () => {
		vi.useFakeTimers()
		build(true)
		boundary.captureError(new Error('fail'))
		const errorId = boundary.currentError?.id ?? ''

		sut.emailReport()

		// Assigned to the same tab's location, not a `_blank` window.
		const { address, subject, body } = parseMailto(fakeWindow.location.href)
		expect(address).toBe('pannpers@pannpers.dev')
		expect(subject).toBe(
			`アプリがうまく動きませんでした（お問い合わせ番号：${errorId}）`,
		)
		const lines = body.split('\r\n')
		expect(lines[0]).toBe('そのとき何をしていたか、ひとことお願いします。')
		expect(lines[1]).toBe('例：ライブの詳細を開こうとした')
		expect(lines.slice(2, 5)).toEqual(['', '', ''])
		expect(lines.slice(5, 8)).toEqual([
			'---',
			'ここから下は、そのまま送ってください。',
			`お問い合わせ番号：${errorId}`,
		])
		expect(lines[8]).toMatch(/^日時：/)
		expect(lines[9]).toBe(`画面：${window.location.pathname}`)

		// A second tap within a minute only says to wait.
		fakeWindow.location.href = ''
		vi.advanceTimersByTime(59_000)
		sut.emailReport()
		expect(fakeWindow.location.href).toBe('')
		expect(ea.publish).toHaveBeenCalledOnce()
		expect(ea.publish.mock.calls[0][0].message).toBe(
			'もう一度メールを開くには、少し待ってください。',
		)
	})

	it(`@spec ${BANNER_SPEC} "Not-sent email carries the investigation details"`, () => {
		build(false)
		const err = new Error(`Bearer abc.def ${'x'.repeat(300)}`)
		rememberRpcSpan(err, {
			traceId: '0af7651916cd43dd8448eb211c80319c',
			spanId: 'b7ad6b7169203331',
		})
		boundary.captureError(err)

		sut.emailReport()

		const { body } = parseMailto(fakeWindow.location.href)
		const lines = body.split('\r\n')
		const block = lines.slice(lines.indexOf('調査用の情報'))
		expect(block[0]).toBe('調査用の情報')
		expect(block[1]).toMatch(/^エラー：Bearer \[REDACTED\] x+$/)
		expect(block[1].length).toBe('エラー：'.length + 200)
		expect(block[2]).toBe('トレースID：0af7651916cd43dd8448eb211c80319c')
	})

	it(`@spec ${BANNER_SPEC} "Sent email carries no technical details"`, () => {
		build(true)
		const err = new Error('Cannot read properties of undefined')
		rememberRpcSpan(err, { traceId: 'trace-1', spanId: 'span-1' })
		boundary.captureError(err)

		sut.emailReport()

		const { body } = parseMailto(fakeWindow.location.href)
		expect(body).not.toContain('調査用の情報')
		expect(body).not.toContain('Cannot read properties')
		expect(body).not.toContain('trace-1')
		expect(body).not.toContain(' at ')
	})

	it('reload reloads the page', () => {
		build(true)

		sut.reload()

		expect(fakeWindow.location.reload).toHaveBeenCalledOnce()
	})
})

/** The sheet itself is not under test; it passes its content through. */
const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<au-slot></au-slot>',
		bindables: ['open', 'dismissable', 'ariaLabel'],
	},
	class {},
)

describe('ErrorBanner page', () => {
	const UNHANDLED = "Cannot read properties of undefined (reading 'id')"
	const SENT_JA =
		'起きたことはチームに届いています。ページを読み込み直してみてください。よければ、何をしていたかメールで教えてください。ひとことだけで大丈夫です。'
	const NOT_SENT_JA =
		'起きたことはチームに届いていません。ページを読み込み直してみてください。何をしていたかメールで教えてください。ひとことだけで大丈夫です。'

	/**
	 * Renders the banner with the real catalog and opens it for an unhandled
	 * rejection. `reported` is what the analytics service answers: `false`
	 * when analytics is off.
	 */
	async function open(lng: 'ja' | 'en', reported = true) {
		const fixture = await createFixture
			.html('<error-banner></error-banner>')
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng,
						fallbackLng: 'ja',
						resources: { ja: { translation: ja }, en: { translation: en } },
					}
				}),
				Registration.instance(IAnalyticsService, createMockAnalytics(reported)),
				Registration.singleton(IErrorBoundaryService, ErrorBoundaryService),
				BottomSheetStub,
				ErrorBanner,
			)
			.build().started
		const boundary = fixture.container.get(IErrorBoundaryService)
		// What the global handler does for an unhandled promise rejection.
		boundary.captureError(new TypeError(UNHANDLED), 'unhandled_rejection')
		await tasksSettled()
		const host = fixture.appHost.querySelector('error-banner')
		if (!host) throw new Error('error-banner did not render')
		return { fixture, host, boundary }
	}

	function labels(host: Element): string[] {
		return [...host.querySelectorAll('button')].map(
			(b) => b.textContent?.trim() ?? '',
		)
	}

	function emailLink(host: Element): HTMLAnchorElement | null {
		return host.querySelector('a.error-email-link')
	}

	beforeEach(() => {
		window.history.replaceState(null, '', '/')
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${BANNER_SPEC} "Error banner renders with error details"`, async () => {
		const { fixture, host, boundary } = await open('ja', false)

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'うまく動きませんでした',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(NOT_SENT_JA)
		expect(host.querySelector('.error-id-label')?.textContent).toBe(
			'お問い合わせ番号',
		)
		expect(host.querySelector('.error-id')?.textContent).toBe(
			boundary.currentError?.id,
		)
		expect(labels(host)).toEqual([
			'ページを読み込み直す',
			'閉じる',
			'メールで状況を伝える',
		])
		expect(host.innerHTML).not.toContain('github')
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Email report is a link when the report was sent"`, async () => {
		const { fixture, host, boundary } = await open('ja', true)

		const link = emailLink(host)
		expect(link?.textContent).toBe('メールで状況を伝える')
		expect(link?.getAttribute('href')).toBe(
			boundary.buildReportMailto(boundary.currentError!),
		)
		expect(labels(host)).toEqual(['ページを読み込み直す', '閉じる'])
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Email report is a button when the report was not sent"`, async () => {
		const { fixture, host } = await open('ja', false)

		expect(emailLink(host)).toBeNull()
		const secondary = host.querySelector('.error-secondary-actions')
		expect(
			[...(secondary?.querySelectorAll('button') ?? [])].map((b) =>
				b.textContent?.trim(),
			),
		).toEqual(['閉じる', 'メールで状況を伝える'])
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Unhandled error shows fixed copy"`, async () => {
		const { fixture, host, boundary } = await open('ja', true)
		const errorId = boundary.currentError?.id ?? ''

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'うまく動きませんでした',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(SENT_JA)
		expect(errorId).toMatch(/^ERR-/)
		expect(host.querySelector('.error-id-label')?.textContent).toBe(
			'お問い合わせ番号',
		)
		expect(host.querySelector('.error-id')?.textContent).toBe(errorId)
		expect(host.textContent).not.toContain('Cannot read properties')
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "English labels"`, async () => {
		const { fixture, host } = await open('en', false)

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'Something went wrong',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(
			"Our team hasn't received the details. Try reloading the page. Please email us what you were doing. One line is enough.",
		)
		expect(host.querySelector('.error-id-label')?.textContent).toBe(
			'Inquiry number',
		)
		expect(labels(host)).toEqual([
			'Reload page',
			'Close',
			'Tell us what happened by email',
		])
		const sheet = host.querySelector('bottom-sheet')
		if (!sheet) throw new Error('bottom-sheet did not render')
		expect(
			CustomElement.for<{ ariaLabel: string }>(sheet).viewModel.ariaLabel,
		).toBe('Error details')
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Not-sent copy when analytics is off"`, async () => {
		// With analytics off, AnalyticsService.captureException returns false.
		const { fixture, host } = await open('ja', false)

		expect(host.querySelector('.error-message')?.textContent).toBe(NOT_SENT_JA)
		await fixture.stop(true)
	})

	it('switches to the sent copy when a queued report is accepted', async () => {
		const { fixture, host, boundary } = await open('ja', false)

		// Report accepted after the banner opened.
		const current = boundary.currentError
		if (current) current.reported = true
		await tasksSettled()

		expect(host.querySelector('.error-message')?.textContent).toBe(SENT_JA)
		expect(emailLink(host)).not.toBeNull()
		await fixture.stop(true)
	})
})
