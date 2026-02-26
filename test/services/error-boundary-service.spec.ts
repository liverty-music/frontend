import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	AppError,
	ErrorBoundaryService,
	IErrorBoundaryService,
} from '../../src/services/error-boundary-service'
import { createTestContainer } from '../helpers/create-container'

describe('AppError', () => {
	it('should create an error from an Error instance', () => {
		const err = new Error('test error')
		const appError = new AppError(err, 'TestContext')

		expect(appError.message).toBe('test error')
		expect(appError.context).toBe('TestContext')
		expect(appError.id).toMatch(/^ERR-/)
		expect(appError.timestamp).toBeInstanceOf(Date)
		expect(appError.stack).toBeTruthy()
	})

	it('should create an error from a non-Error value', () => {
		const appError = new AppError('string error')

		expect(appError.message).toBe('string error')
		expect(appError.stack).toBe('')
		expect(appError.context).toBe('unknown')
	})
})

describe('ErrorBoundaryService', () => {
	let sut: ErrorBoundaryService

	beforeEach(() => {
		const container = createTestContainer()
		container.register(ErrorBoundaryService)
		sut = container.get(IErrorBoundaryService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('captureError', () => {
		it('should set currentError', () => {
			sut.captureError(new Error('test'), 'ctx')

			expect(sut.currentError).not.toBeNull()
			expect(sut.currentError!.message).toBe('test')
		})

		it('should add to errorHistory', () => {
			sut.captureError(new Error('e1'))
			sut.captureError(new Error('e2'))

			expect(sut.errorHistory).toHaveLength(2)
		})

		it('should cap history at 20 entries', () => {
			for (let i = 0; i < 25; i++) {
				sut.captureError(new Error(`error ${i}`))
			}

			expect(sut.errorHistory).toHaveLength(20)
			// The first 5 should have been shifted out
			expect(sut.errorHistory[0].message).toBe('error 5')
		})
	})

	describe('dismiss', () => {
		it('should clear currentError', () => {
			sut.captureError(new Error('test'))
			expect(sut.currentError).not.toBeNull()

			sut.dismiss()
			expect(sut.currentError).toBeNull()
		})
	})

	describe('addBreadcrumb', () => {
		it('should add a breadcrumb entry', () => {
			sut.addBreadcrumb('click', 'Follow button')

			expect(sut.breadcrumbs).toHaveLength(1)
			expect(sut.breadcrumbs[0].type).toBe('click')
			expect(sut.breadcrumbs[0].label).toBe('Follow button')
		})

		it('should cap breadcrumbs at 30 entries (ring buffer)', () => {
			for (let i = 0; i < 35; i++) {
				sut.addBreadcrumb('click', `action ${i}`)
			}

			expect(sut.breadcrumbs).toHaveLength(30)
			expect(sut.breadcrumbs[0].label).toBe('action 5')
		})
	})

	describe('generateReport', () => {
		it('should produce markdown output with error details', () => {
			sut.captureError(new Error('report error'), 'ReportTest')
			const report = sut.generateReport(sut.currentError!)

			expect(report).toContain('## Error Report')
			expect(report).toContain('report error')
			expect(report).toContain('ReportTest')
			expect(report).toContain('### Stack Trace')
		})

		it('should include recent breadcrumbs', () => {
			sut.addBreadcrumb('navigation', 'Navigate to /dashboard')
			sut.addBreadcrumb('click', 'Retry button')

			sut.captureError(new Error('test'))
			const report = sut.generateReport(sut.currentError!)

			expect(report).toContain('Navigate to /dashboard')
			expect(report).toContain('Retry button')
		})

		it('should show placeholder when no breadcrumbs exist', () => {
			sut.captureError(new Error('test'))
			const report = sut.generateReport(sut.currentError!)

			expect(report).toContain('_No breadcrumbs recorded_')
		})
	})

	describe('sanitize (via generateReport)', () => {
		it('should redact Bearer tokens', () => {
			const err = new Error(
				'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
			)
			sut.captureError(err)
			const report = sut.generateReport(sut.currentError!)

			expect(report).toContain('Bearer [REDACTED]')
		})

		it('should redact query parameters with sensitive keys', () => {
			const err = new Error(
				'Error at /callback?code=abc123&state=xyz789&access_token=secret',
			)
			sut.captureError(err)
			const report = sut.generateReport(sut.currentError!)

			expect(report).not.toContain('abc123')
			expect(report).not.toContain('secret')
			expect(report).toContain('[REDACTED]')
		})
	})

	describe('buildGitHubIssueUrl', () => {
		it('should return a GitHub issue URL with title and body', () => {
			sut.captureError(new Error('bug found'), 'TestSuite')
			const url = sut.buildGitHubIssueUrl(sut.currentError!)

			expect(url).toContain(
				'https://github.com/liverty-music/frontend/issues/new?',
			)
			expect(url).toContain('bug+found')
			expect(url).toContain('labels=bug')
		})

		it('should truncate long bodies to keep URL reasonable', () => {
			// Create a very long error message
			const longMessage = 'x'.repeat(5000)
			const err = new Error(longMessage)
			sut.captureError(err)
			const url = sut.buildGitHubIssueUrl(sut.currentError!)

			// The URL should contain the truncation notice
			expect(url).toContain('truncated')
		})
	})
})
