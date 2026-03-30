import { vi } from 'vitest'

export function createMockHistory() {
	return {
		pushState: vi.fn(),
		replaceState: vi.fn(),
	}
}
