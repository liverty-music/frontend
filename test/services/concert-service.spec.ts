import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const mockConcertRpcClient = {
	listConcerts: vi.fn().mockResolvedValue([]),
	listByFollower: vi.fn().mockResolvedValue([]),
	listWithProximity: vi.fn().mockResolvedValue([]),
	searchNewConcerts: vi.fn().mockResolvedValue(undefined),
	listSearchStatuses: vi.fn().mockResolvedValue([]),
}

const mockIConcertRpcClient = DI.createInterface('IConcertRpcClient')
vi.mock('../../src/adapter/rpc/client/concert-client', () => ({
	IConcertRpcClient: mockIConcertRpcClient,
}))

const mockIAuthService = DI.createInterface('IAuthService')
vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const mockIOnboardingService = DI.createInterface('IOnboardingService')
vi.mock('../../src/services/onboarding-service', () => ({
	IOnboardingService: mockIOnboardingService,
	OnboardingStep: {
		LP: 'lp',
		DISCOVERY: 'discovery',
		DASHBOARD: 'dashboard',
		DETAIL: 'detail',
		MY_ARTISTS: 'my-artists',
		COMPLETED: 'completed',
	},
}))

const mockIGuestService = DI.createInterface('IGuestService')
vi.mock('../../src/services/guest-service', () => ({
	IGuestService: mockIGuestService,
}))

const { ConcertServiceClient, IConcertService } = await import(
	'../../src/services/concert-service'
)

describe('ConcertServiceClient', () => {
	let sut: InstanceType<typeof ConcertServiceClient>

	beforeEach(() => {
		vi.clearAllMocks()
		mockConcertRpcClient.listConcerts.mockResolvedValue([])
		mockConcertRpcClient.listByFollower.mockResolvedValue([])
		mockConcertRpcClient.listWithProximity.mockResolvedValue([])
		mockConcertRpcClient.searchNewConcerts.mockResolvedValue(undefined)
		mockConcertRpcClient.listSearchStatuses.mockResolvedValue([])

		const mockAuth = createMockAuth({ isAuthenticated: true })

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIOnboardingService, {
				isOnboarding: false,
			}),
			Registration.instance(mockIGuestService, {
				follows: [],
				home: null,
				followedCount: 0,
			}),
			Registration.instance(mockIConcertRpcClient, mockConcertRpcClient),
		)
		container.register(ConcertServiceClient)
		sut = container.get(IConcertService)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('listConcerts', () => {
		it('should return concerts from the backend', async () => {
			const fakeConcerts = [{ id: 'c1' }, { id: 'c2' }]
			mockConcertRpcClient.listConcerts.mockResolvedValue(fakeConcerts)

			const result = await sut.listConcerts('artist-1')

			expect(result).toEqual(fakeConcerts)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.listConcerts('artist-1', controller.signal)

			expect(mockConcertRpcClient.listConcerts).toHaveBeenCalledWith(
				'artist-1',
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.listConcerts.mockRejectedValue(
				new Error('rpc error'),
			)

			await expect(sut.listConcerts('artist-1')).rejects.toThrow('rpc error')
		})
	})

	describe('listByFollower', () => {
		it('should delegate to rpcClient when not onboarding', async () => {
			const fakeGroups = [{ date: '2026-03-15' }]
			mockConcertRpcClient.listByFollower.mockResolvedValue(fakeGroups)

			const result = await sut.listByFollower()

			expect(result).toEqual(fakeGroups)
			expect(mockConcertRpcClient.listByFollower).toHaveBeenCalled()
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()
			mockConcertRpcClient.listByFollower.mockResolvedValue([])

			await sut.listByFollower(controller.signal)

			expect(mockConcertRpcClient.listByFollower).toHaveBeenCalledWith(
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.listByFollower.mockRejectedValue(
				new Error('rpc error'),
			)

			await expect(sut.listByFollower()).rejects.toThrow('rpc error')
		})
	})

	describe('searchNewConcerts', () => {
		it('should call searchNewConcerts on the rpc client', async () => {
			await sut.searchNewConcerts('artist-1')

			expect(mockConcertRpcClient.searchNewConcerts).toHaveBeenCalledTimes(1)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.searchNewConcerts('artist-1', controller.signal)

			expect(mockConcertRpcClient.searchNewConcerts).toHaveBeenCalledWith(
				'artist-1',
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.searchNewConcerts.mockRejectedValue(
				new Error('search failed'),
			)

			await expect(sut.searchNewConcerts('artist-1')).rejects.toThrow(
				'search failed',
			)
		})
	})

	describe('listSearchStatuses', () => {
		it('should return mapped statuses for given artist IDs', async () => {
			const fakeStatuses = [
				{ artistId: { value: 'a1' }, status: 2 },
				{ artistId: { value: 'a2' }, status: 1 },
			]
			mockConcertRpcClient.listSearchStatuses.mockResolvedValue(fakeStatuses)

			const result = await sut.listSearchStatuses(['a1', 'a2'])

			expect(result).toEqual([
				{ artistId: 'a1', status: 'completed' },
				{ artistId: 'a2', status: 'pending' },
			])
			expect(mockConcertRpcClient.listSearchStatuses).toHaveBeenCalledTimes(1)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.listSearchStatuses(['a1'], controller.signal)

			expect(mockConcertRpcClient.listSearchStatuses).toHaveBeenCalledWith(
				['a1'],
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.listSearchStatuses.mockRejectedValue(
				new Error('poll failed'),
			)

			await expect(sut.listSearchStatuses(['a1'])).rejects.toThrow(
				'poll failed',
			)
		})
	})
})
