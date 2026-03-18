import { IEventAggregator } from 'aurelia'
import { vi } from 'vitest'
import { Snack } from '../../src/components/snack-bar/snack'

/**
 * Creates a mock IEventAggregator that captures published Snack events.
 */
export function createMockEventAggregator() {
	const published: Snack[] = []
	return {
		publish: vi.fn((event: unknown) => {
			if (event instanceof Snack) {
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
