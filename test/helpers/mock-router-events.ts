import { vi } from 'vitest'

export function createMockRouterEvents() {
	return {
		subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	}
}
