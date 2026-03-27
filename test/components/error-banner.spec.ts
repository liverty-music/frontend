import { I18N } from '@aurelia/i18n'
import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBanner } from '../../src/components/error-banner/error-banner'
import { IErrorBoundaryService } from '../../src/services/error-boundary-service'
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
