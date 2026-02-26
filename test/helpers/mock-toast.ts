import { vi } from 'vitest'
import type { IToastService } from '../../src/components/toast-notification/toast-notification'

/**
 * Creates a mock implementation of IToastService for testing.
 */
export function createMockToastService(): Partial<IToastService> {
	return {
		toasts: [],
		show: vi.fn(),
		severityClass: vi.fn().mockReturnValue(''),
	}
}
