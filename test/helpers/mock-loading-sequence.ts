import { vi } from 'vitest'
import type { ILoadingSequenceService } from '../../src/services/loading-sequence-service'

/**
 * Creates a mock implementation of ILoadingSequenceService for testing.
 */
export function createMockLoadingSequenceService(): Partial<ILoadingSequenceService> {
	return {
		aggregateData: vi.fn().mockResolvedValue({ status: 'success' }),
	}
}
