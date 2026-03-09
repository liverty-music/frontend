import { IEventAggregator } from 'aurelia'
import { vi } from 'vitest'
import { Toast } from '../../src/components/toast-notification/toast'

/**
 * Creates a mock IEventAggregator that captures published Toast events.
 */
export function createMockEventAggregator() {
	const published: Toast[] = []
	return {
		publish: vi.fn((event: unknown) => {
			if (event instanceof Toast) {
				published.push(event)
			}
		}),
		subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		subscribeOnce: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		published,
		/** The DI interface key for IEventAggregator. */
		key: IEventAggregator,
	}
}
