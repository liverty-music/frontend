import { vi } from 'vitest'
import type { ITicketService } from '../../src/services/ticket-service'

/**
 * Creates a mock implementation of ITicketService for testing.
 */
export function createMockTicketService(): Partial<ITicketService> {
	return {
		listTickets: vi.fn().mockResolvedValue([]),
	}
}
