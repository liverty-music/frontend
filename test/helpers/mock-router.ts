import type { IRouter } from '@aurelia/router'
import { vi } from 'vitest'

/**
 * Creates a mock implementation of IRouter for testing.
 */
export function createMockRouter(): Partial<IRouter> {
	return {
		load: vi.fn().mockResolvedValue(undefined),
	}
}
