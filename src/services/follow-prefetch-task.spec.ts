import type { IContainer } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = { scopeTo: () => mockLogger, warn: vi.fn() }
const mockAuth = { ready: Promise.resolve(), isAuthenticated: true }
const mockFollowStore = { ensureLoaded: vi.fn(async () => []) }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		ILogger: { friendlyName: 'ILogger' },
		IContainer: { friendlyName: 'IContainer' },
		AppTask: { activating: (_key: unknown, fn: unknown) => fn },
	}
})
vi.mock('./auth-service', () => ({
	IAuthService: { friendlyName: 'IAuthService' },
}))
vi.mock('./follow-store', () => ({
	IFollowStore: { friendlyName: 'IFollowStore' },
}))

import { runFollowPrefetch } from './follow-prefetch-task'

const container = {
	get: vi.fn((token: { friendlyName?: string }) => {
		const map: Record<string, unknown> = {
			ILogger: mockLogger,
			IAuthService: mockAuth,
			IFollowStore: mockFollowStore,
		}
		return map[token.friendlyName ?? '']
	}),
} as unknown as IContainer

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('runFollowPrefetch', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockFollowStore.ensureLoaded.mockImplementation(async () => [])
	})

	it('starts loading the follow list once the session is known, without blocking', async () => {
		const result = runFollowPrefetch(container)

		expect(result).toBeUndefined()
		await flush()
		expect(mockFollowStore.ensureLoaded).toHaveBeenCalledOnce()
	})

	it('does nothing for a guest', async () => {
		mockAuth.isAuthenticated = false

		runFollowPrefetch(container)
		await flush()

		expect(mockFollowStore.ensureLoaded).not.toHaveBeenCalled()
	})

	it('logs a failed load instead of rejecting', async () => {
		mockFollowStore.ensureLoaded.mockRejectedValue(new Error('unavailable'))

		runFollowPrefetch(container)
		await flush()

		expect(mockLogger.warn).toHaveBeenCalled()
	})
})
