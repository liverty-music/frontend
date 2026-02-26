import { vi } from 'vitest'
import type { IProofService } from '../../src/services/proof-service'

/**
 * Creates a mock implementation of IProofService for testing.
 */
export function createMockProofService(): Partial<IProofService> {
	return {
		generateEntryProof: vi.fn().mockResolvedValue({
			proofJson: '{}',
			publicSignalsJson: '[]',
		}),
	}
}
