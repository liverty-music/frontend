import { vi } from 'vitest'
import type { ITicketRpcClient } from '../../src/adapter/rpc/client/ticket-client'

/**
 * Creates a mock implementation of ITicketRpcClient for testing.
 */
export function createMockTicketService(): Partial<ITicketRpcClient> {
	return {
		listTickets: vi.fn().mockResolvedValue([]),
	}
}
