import { I18N, I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBanner } from '../../src/components/error-banner/error-banner'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import {
	ErrorBoundaryService,
	IErrorBoundaryService,
} from '../../src/services/error-boundary-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockErrorBoundary } from '../helpers/mock-error-boundary'
import { createMockI18n } from '../helpers/mock-i18n'

describe('ErrorBanner', () => {
	let sut: ErrorBanner
	let mockBoundary: ReturnType<typeof createMockErrorBoundary>
	let mockEa: { publish: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockBoundary = createMockErrorBoundary()
		mockEa = { publish: vi.fn() }

		const container = createTestContainer(
			Registration.instance(IErrorBoundaryService, mockBoundary),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(I18N, createMockI18n()),
		)
		container.register(ErrorBanner)
		sut = container.get(ErrorBanner)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('dismiss delegates to errorBoundary.dismiss()', () => {
		sut.dismiss()
		expect(mockBoundary.dismiss).toHaveBeenCalledOnce()
	})

	it('copyErrorDetails copies report to clipboard', async () => {
		const mockError = { id: 'err-1', message: 'fail' }
		mockBoundary.currentError = mockError as any
		mockBoundary.generateReport = vi.fn().mockReturnValue('report text')
		Object.assign(navigator, {
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
		})

		await sut.copyErrorDetails()

		expect(mockBoundary.generateReport).toHaveBeenCalledWith(mockError)
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('report text')
	})

	it('reportToGitHub opens issue URL in new window', () => {
		const mockError = { id: 'err-1', message: 'fail' }
		mockBoundary.currentError = mockError as any
		mockBoundary.buildGitHubIssueUrl = vi
			.fn()
			.mockReturnValue('https://github.com/test/issue')
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

		sut.reportToGitHub()

		expect(mockBoundary.buildGitHubIssueUrl).toHaveBeenCalledWith(mockError)
		expect(openSpy).toHaveBeenCalledWith(
			'https://github.com/test/issue',
			'_blank',
			'noopener',
		)
	})

	it('reportToGitHub respects cooldown', () => {
		const mockError = { id: 'err-1', message: 'fail' }
		mockBoundary.currentError = mockError as any
		mockBoundary.buildGitHubIssueUrl = vi.fn().mockReturnValue('url')
		vi.spyOn(window, 'open').mockImplementation(() => null)

		sut.reportToGitHub()
		sut.reportToGitHub()

		expect(mockBoundary.buildGitHubIssueUrl).toHaveBeenCalledOnce()
		expect(mockEa.publish).toHaveBeenCalledOnce()
	})
})

const BANNER_SPEC = 'components/infrastructure/fan/web/global/error-banner'

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

	/** Renders the banner with the real catalog and opens it for an unhandled rejection. */
	async function open(lng: 'ja' | 'en') {
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
				Registration.singleton(IErrorBoundaryService, ErrorBoundaryService),
				BottomSheetStub,
				ErrorBanner,
			)
			.build().started
		const boundary = fixture.container.get(IErrorBoundaryService)
		// What the global handler does for an unhandled promise rejection.
		boundary.captureError(new TypeError(UNHANDLED), 'unhandledrejection')
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

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${BANNER_SPEC} "Unhandled error shows fixed copy"`, async () => {
		const { fixture, host, boundary } = await open('ja')
		const errorId = boundary.currentError?.id ?? ''

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'問題が発生しました',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(
			'予期しないエラーが発生しました。ページを再読み込みしてください。',
		)
		expect(errorId).toMatch(/^ERR-/)
		expect(host.querySelector('.error-id')?.textContent).toBe(errorId)
		expect(host.textContent).not.toContain('Cannot read properties')
		expect(labels(host)).toEqual([
			'詳細をコピー',
			'GitHub で報告',
			'閉じる',
			'ページを再読み込み',
		])

		// The copied details keep the error's message for diagnosis.
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.assign(navigator, { clipboard: { writeText } })
		host.querySelectorAll('button')[0].click()
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce())
		expect(writeText.mock.calls[0][0]).toContain(UNHANDLED)
		await fixture.stop(true)
	})

	it(`@spec ${BANNER_SPEC} "English labels"`, async () => {
		const { fixture, host } = await open('en')

		expect(host.querySelector('.error-title')?.textContent).toBe(
			'Something went wrong',
		)
		expect(host.querySelector('.error-message')?.textContent).toBe(
			'An unexpected error occurred. Reload the page.',
		)
		expect(labels(host)).toEqual([
			'Copy details',
			'Report to GitHub',
			'Dismiss',
			'Reload page',
		])
		const sheet = host.querySelector('bottom-sheet')
		if (!sheet) throw new Error('bottom-sheet did not render')
		expect(
			CustomElement.for<{ ariaLabel: string }>(sheet).viewModel.ariaLabel,
		).toBe('Error details')
		await fixture.stop(true)
	})
})
