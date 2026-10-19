import type { IContainer } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = { scopeTo: () => mockLogger, warn: vi.fn() }
const mockAuth = { ready: Promise.resolve(), isAuthenticated: true }
const mockFollows = {
	ensureLoaded: vi.fn(async () => []),
	keptFollowedArtists: vi.fn((): { id: string }[] => []),
	hydrate: vi.fn(),
	guestFollows: [] as { artist: { id: string } }[],
}
const mockOnboarding = { isOnboarding: false }
const mockBubbles = { prefetchInitial: vi.fn() }

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
vi.mock('./onboarding-service', () => ({
	IOnboardingService: { friendlyName: 'IOnboardingService' },
}))
vi.mock('./artist-bubble-store', () => ({
	IArtistBubbleStore: { friendlyName: 'IArtistBubbleStore' },
}))
vi.mock('./user-hydration-task', () => ({
	opensOnDiscovery: (p: string) => p.startsWith('/discovery'),
}))

import { runDiscoveryPrefetch } from './discovery-prefetch-task'

const container = {
	get: vi.fn((token: { friendlyName?: string }) => {
		const map: Record<string, unknown> = {
			ILogger: mockLogger,
			IAuthService: mockAuth,
			IFollowStore: mockFollows,
			IOnboardingService: mockOnboarding,
			IArtistBubbleStore: mockBubbles,
		}
		return map[token.friendlyName ?? '']
	}),
} as unknown as IContainer

const flush = async () => {
	for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('runDiscoveryPrefetch', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.isAuthenticated = true
		mockOnboarding.isOnboarding = false
		mockFollows.guestFollows = []
		mockFollows.ensureLoaded.mockImplementation(async () => [])
		mockFollows.keptFollowedArtists.mockImplementation(() => [])
	})

	// @spec components/infrastructure/fan/web/route/discovery "Initial load starts during start-up when the app opens on Discovery"
	it('loads the follow list, then starts the field load, for a signed-in fan opening Discovery', async () => {
		runDiscoveryPrefetch(container, '/discovery', 375)
		await flush()

		expect(mockFollows.ensureLoaded).toHaveBeenCalledOnce()
		expect(mockBubbles.prefetchInitial).toHaveBeenCalledWith(375)
		expect(mockFollows.ensureLoaded.mock.invocationCallOrder[0]).toBeLessThan(
			mockBubbles.prefetchInitial.mock.invocationCallOrder[0],
		)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Initial load starts during start-up when the app opens on Discovery"
	// @spec components/infrastructure/fan/web/route/discovery "Seeds come from the follows kept on the device"
	it('starts the field load from the follows kept from the last start, without waiting for the follow list', async () => {
		const kept = [{ id: 'k1' }, { id: 'k2' }]
		mockFollows.keptFollowedArtists.mockImplementation(() => kept)
		mockFollows.ensureLoaded.mockImplementation(() => new Promise(() => {}))

		runDiscoveryPrefetch(container, '/discovery', 375)
		await flush()

		expect(mockBubbles.prefetchInitial).toHaveBeenCalledWith(375, kept)
		expect(mockFollows.ensureLoaded).not.toHaveBeenCalled()
	})

	it('restores an onboarding guest’s follows before the field load', async () => {
		mockAuth.isAuthenticated = false
		mockOnboarding.isOnboarding = true
		mockFollows.guestFollows = [{ artist: { id: 'g1' } }]

		runDiscoveryPrefetch(container, '/discovery', 400)
		await flush()

		expect(mockFollows.hydrate).toHaveBeenCalledWith([{ id: 'g1' }])
		expect(mockBubbles.prefetchInitial).toHaveBeenCalledWith(400)
	})

	it('does nothing when the app opens on another route', async () => {
		runDiscoveryPrefetch(container, '/dashboard', 400)
		await flush()

		expect(mockFollows.ensureLoaded).not.toHaveBeenCalled()
		expect(mockBubbles.prefetchInitial).not.toHaveBeenCalled()
	})

	it('leaves the load to the route when the follow list fails', async () => {
		mockFollows.ensureLoaded.mockRejectedValue(new Error('unavailable'))

		runDiscoveryPrefetch(container, '/discovery', 400)
		await flush()

		expect(mockBubbles.prefetchInitial).not.toHaveBeenCalled()
		expect(mockLogger.warn).toHaveBeenCalled()
	})
})
