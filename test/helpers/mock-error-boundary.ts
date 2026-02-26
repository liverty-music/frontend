import { vi } from 'vitest'
import type { IErrorBoundaryService } from '../../src/services/error-boundary-service'

/**
 * Creates a mock implementation of IErrorBoundaryService for testing.
 */
export function createMockErrorBoundary(): Partial<IErrorBoundaryService> {
	return {
		currentError: null,
		errorHistory: [],
		breadcrumbs: [],
		captureError: vi.fn(),
		dismiss: vi.fn(),
		addBreadcrumb: vi.fn(),
		generateReport: vi.fn().mockReturnValue(''),
		buildGitHubIssueUrl: vi.fn().mockReturnValue(''),
	}
}
