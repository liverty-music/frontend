import { vi } from 'vitest'
import type { IAnalyticsService } from '../../src/lib/analytics/analytics-service'

/**
 * Creates a mock implementation of IAnalyticsService for testing. Assert on
 * `capture` to check the usage events a component sends.
 */
export function createMockAnalytics() {
	return {
		capture: vi.fn(),
		identify: vi.fn(),
		reset: vi.fn(),
		getFeatureFlag: vi.fn(
			(_key: string, defaultValue: unknown) => defaultValue,
		),
		captureException: vi.fn().mockReturnValue(false),
		addExceptionStep: vi.fn(),
	} satisfies IAnalyticsService
}
