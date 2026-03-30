import { vi } from 'vitest'

export function createMockLocalStorage(initial: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initial }

	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key]
		}),
	}
}
