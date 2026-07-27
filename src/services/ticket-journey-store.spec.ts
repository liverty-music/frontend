import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JourneyStatus } from '../entities/concert'
import { SignedOut } from './events/signed-out'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}
const mockAuth = { isAuthenticated: true }
const mockRpcClient = {
	listByUser: vi.fn(async (): Promise<Map<string, JourneyStatus>> => new Map()),
	setStatus: vi.fn(async () => undefined),
	delete: vi.fn(async () => undefined),
}

type Handler = (event: unknown) => void
const subscriptions = new Map<unknown, Handler>()
const mockEa = {
	subscribe: vi.fn((channel: unknown, handler: Handler) => {
		subscriptions.set(channel, handler)
		return { dispose: vi.fn() }
	}),
	publish: vi.fn(),
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token: unknown) => {
			const map: Record<string, unknown> = {
				ILogger: mockLogger,
				IAuthService: mockAuth,
				ITicketJourneyRpcClient: mockRpcClient,
				IEventAggregator: mockEa,
			}
			const tokenAny = token as { friendlyName?: string }
			return map[tokenAny.friendlyName ?? ''] ?? {}
		}),
		observable: actual.observable,
	}
})

import { TicketJourneyStore } from './ticket-journey-store'

describe('TicketJourneyStore', () => {
	let sut: TicketJourneyStore

	beforeEach(() => {
		vi.clearAllMocks()
		subscriptions.clear()
		mockAuth.isAuthenticated = true
		sut = new TicketJourneyStore()
	})

	describe('load', () => {
		it('populates the observable map from listByUser (network-first)', async () => {
			mockRpcClient.listByUser.mockResolvedValueOnce(
				new Map<string, JourneyStatus>([['e1', 'applied']]),
			)

			const map = await sut.load()

			expect(mockRpcClient.listByUser).toHaveBeenCalledTimes(1)
			expect(map.get('e1')).toBe('applied')
			expect(sut.statusFor('e1')).toBe('applied')
		})

		it('returns an empty map without an RPC for a guest', async () => {
			mockAuth.isAuthenticated = false

			const map = await sut.load()

			expect(mockRpcClient.listByUser).not.toHaveBeenCalled()
			expect(map.size).toBe(0)
		})
	})

	describe('setStatus — write-through', () => {
		it('updates the observable map only after the RPC succeeds', async () => {
			await sut.setStatus('e1', 'applied')

			expect(mockRpcClient.setStatus).toHaveBeenCalledWith(
				'e1',
				'applied',
				undefined,
			)
			expect(sut.statusFor('e1')).toBe('applied')
		})

		it('replaces the map reference so observers re-render', async () => {
			const before = sut.journeyMap
			await sut.setStatus('e1', 'applied')
			expect(sut.journeyMap).not.toBe(before)
		})

		it('does not update the map when the RPC fails (no desync)', async () => {
			mockRpcClient.setStatus.mockRejectedValueOnce(new Error('boom'))

			await expect(sut.setStatus('e1', 'applied')).rejects.toThrow('boom')
			expect(sut.statusFor('e1')).toBeUndefined()
		})
	})

	describe('delete — write-through', () => {
		it('drops the entry after the RPC succeeds', async () => {
			await sut.setStatus('e1', 'applied')
			await sut.delete('e1')

			expect(mockRpcClient.delete).toHaveBeenCalledWith('e1', undefined)
			expect(sut.statusFor('e1')).toBeUndefined()
		})

		it('keeps the entry when the delete RPC fails', async () => {
			await sut.setStatus('e1', 'applied')
			mockRpcClient.delete.mockRejectedValueOnce(new Error('nope'))

			await expect(sut.delete('e1')).rejects.toThrow('nope')
			expect(sut.statusFor('e1')).toBe('applied')
		})
	})

	describe('load — write-through fence', () => {
		it('does not let a stale in-flight load() clobber a write that lands first', async () => {
			let releaseList: (m: Map<string, JourneyStatus>) => void = () => {}
			const listPromise = new Promise<Map<string, JourneyStatus>>((r) => {
				releaseList = r
			})
			mockRpcClient.listByUser.mockReturnValueOnce(listPromise)

			// load() captures the write generation, then blocks on the RPC.
			const loadP = sut.load()
			// A write-through lands while the load is in flight.
			await sut.setStatus('e1', 'applied')
			// The server snapshot resolves WITHOUT the just-written status.
			releaseList(new Map<string, JourneyStatus>([['e2', 'paid']]))
			await loadP

			// The newer write-through survived; the stale snapshot did not overwrite it.
			expect(sut.statusFor('e1')).toBe('applied')
		})
	})

	describe('sign-out', () => {
		it('clears the journey map when SignedOut fires', async () => {
			await sut.setStatus('e1', 'applied')
			expect(sut.statusFor('e1')).toBe('applied')

			const handler = subscriptions.get(SignedOut)
			handler?.(new SignedOut())

			expect(sut.statusFor('e1')).toBeUndefined()
			expect(sut.journeyMap.size).toBe(0)
		})
	})
})
