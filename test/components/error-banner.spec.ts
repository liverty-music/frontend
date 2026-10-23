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
	const MESSAGE_JA =
		'ですが、ご安心ください！\nエンジニアチームがすぐに原因調査を行います。\n再発防止のため、メールで簡単に状況を教えてもらえると非常に助かります🙇‍♀️'

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

	beforeEach(() => {
		window.history.replaceState(null, '', '/')
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${BANNER_SPEC} "Error banner renders with error details"`, async () => {
		const { fixture, host, boundary } = await open('ja', false)

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'⚡️ライブ中にアクシデント発生⚡️',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(MESSAGE_JA)
		expect(host.textContent).not.toContain(boundary.currentError?.id ?? '-')
		expect(labels(host)).toEqual([
			'メールで状況を伝える',
			'ページを読み込み直す',
			'閉じる',
		])
		// The email is the primary action; the others are outlined.
		const [email, reload, close] = host.querySelectorAll('button')
		expect(email.dataset.variant).toBeUndefined()
		expect(reload.dataset.variant).toBe('outlined')
		expect(close.dataset.variant).toBe('outlined')
		expect(host.innerHTML).not.toContain('github')
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Address shown for a device without a mail app"`, async () => {
		const { fixture, host } = await open('ja', true)
		// jsdom does not navigate for `mailto:`; the page cannot tell either.
		const fallback = () => host.querySelector('.error-email-fallback')

		expect(fallback()).toBeNull()
		host.querySelectorAll('button')[0].click()
		await tasksSettled()

		expect(fallback()?.textContent).toBe(
			'メールが開かない場合は、pannpers@pannpers.dev までご連絡ください。',
		)
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "Unhandled error shows fixed copy"`, async () => {
		const { fixture, host, boundary } = await open('ja', true)
		const errorId = boundary.currentError?.id ?? ''

		expect(errorId).toMatch(/^ERR-/)
		expect(host.querySelector('.error-title')?.textContent).toBe(
			'⚡️ライブ中にアクシデント発生⚡️',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(MESSAGE_JA)
		expect(host.textContent).not.toContain('Cannot read properties')
		expect(host.textContent).not.toContain(errorId)
		await fixture.stop(true)
	})

	it('shows the same message when the report was not sent', async () => {
		const { fixture, host } = await open('ja', false)

		expect(host.querySelector('.error-message')?.textContent).toBe(MESSAGE_JA)
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "English labels"`, async () => {
		const { fixture, host } = await open('en', false)

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'⚡️Something went wrong mid-show⚡️',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(
			"But don't worry!\nOur engineering team will look into it right away.\nTo help keep it from happening again, a quick email about what happened would help us a lot 🙇‍♀️",
		)
		expect(labels(host)).toEqual([
			'Tell us what happened by email',
			'Reload page',
			'Close',
		])
		const sheet = host.querySelector('bottom-sheet')
		if (!sheet) throw new Error('bottom-sheet did not render')
		expect(
			CustomElement.for<{ ariaLabel: string }>(sheet).viewModel.ariaLabel,
		).toBe('Error details')
		await fixture.stop(true)
	})
})
