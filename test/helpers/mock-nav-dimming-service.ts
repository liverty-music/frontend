import { vi } from 'vitest'

export function createMockNavDimmingService() {
	return {
		setDimmed: vi.fn(),
	}
}
