import type { ILogger } from 'aurelia'
import { vi } from 'vitest'

/**
 * Creates a mock implementation of Aurelia's ILogger for testing.
 * All methods are Vitest spy functions.
 */
export function createMockLogger(): ILogger {
	const mockLogger: ILogger = {
		scopeTo: vi.fn().mockReturnThis(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}
	return mockLogger as ILogger
}
