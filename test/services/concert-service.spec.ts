import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const mockConcertRpcClient = {
	listConcerts: vi.fn().mockResolvedValue([]),
	listByFollower: vi.fn().mockResolvedValue([]),
	listWithProximity: vi.fn().mockResolvedValue([]),
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
	let mockLoggerWarn: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		mockConcertRpcClient.listConcerts.mockResolvedValue([])
		mockConcertRpcClient.listByFollower.mockResolvedValue([])
		mockConcertRpcClient.listWithProximity.mockResolvedValue([])

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
		// The mock ILogger's scopeTo returns the same instance (mockReturnThis),
		// so the scoped logger inside ConcertServiceClient calls the very same
		// warn spy we grab from the container here.
		mockLoggerWarn = (
			container.get(ILogger) as { warn: ReturnType<typeof vi.fn> }
		).warn
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

	describe('addArtistWithConcerts', () => {
		it('should add artist to the set', () => {
			sut.addArtistWithConcerts('a1')
			expect(sut.artistsWithConcertsCount).toBe(1)

			sut.addArtistWithConcerts('a2')
			expect(sut.artistsWithConcertsCount).toBe(2)
		})

		it('should not duplicate', () => {
			sut.addArtistWithConcerts('a1')
			sut.addArtistWithConcerts('a1')
			expect(sut.artistsWithConcertsCount).toBe(1)
		})
	})

	describe('toDateGroups (performer resolution)', () => {
		function makeConcert(overrides: Record<string, unknown> = {}) {
			return {
				id: { value: 'c1' },
				performers: [
					{
						id: { value: 'a-headliner' },
						name: { value: 'Headliner' },
						mbid: { value: '' },
					},
				],
				series: {
					id: { value: 's1' },
					title: { value: 'Test Show' },
					sourceUrl: { value: '' },
				},
				localDate: { value: { year: 2026, month: 3, day: 15 } },
				venue: { name: { value: 'Venue' }, adminArea: { value: 'JP-13' } },
				...overrides,
			}
		}
		const dateLD = { year: 2026, month: 3, day: 15 }

		it('resolves a followed artist that matches performers[0]', () => {
			const group = {
				date: { value: dateLD },
				home: [makeConcert()],
				nearby: [],
				away: [],
			}
			const artist = { id: 'a-headliner', name: 'Headliner', mbid: '' }
			const artistMap = new Map([
				['a-headliner', { artist, hype: 'watch' as const }],
			])
			const [dg] = sut.toDateGroups([group as never], artistMap)
			expect(dg.home).toHaveLength(1)
			expect(dg.home[0].artistId).toBe('a-headliner')
			expect(dg.home[0].artistName).toBe('Headliner')
			expect(dg.home[0].artist).toBe(artist)
			expect(mockLoggerWarn).not.toHaveBeenCalled()
		})

		it('picks the first MATCHED performer, not necessarily performers[0]', () => {
			// performers[0] is an unfollowed headliner; performers[1] is the
			// followed support act. The resolver must skip the headliner and
			// resolve the support act so the entity's artist context is
			// internally consistent.
			const concert = makeConcert({
				performers: [
					{
						id: { value: 'a-unfollowed-headliner' },
						name: { value: 'Headliner' },
						mbid: { value: '' },
					},
					{
						id: { value: 'a-followed-support' },
						name: { value: 'Support' },
						mbid: { value: '' },
					},
				],
			})
			const group = {
				date: { value: dateLD },
				home: [concert],
				nearby: [],
				away: [],
			}
			const artist = { id: 'a-followed-support', name: 'Support', mbid: '' }
			const artistMap = new Map([
				['a-followed-support', { artist, hype: 'watch' as const }],
			])
			const [dg] = sut.toDateGroups([group as never], artistMap)
			expect(dg.home[0].artistId).toBe('a-followed-support')
			expect(dg.home[0].artist).toBe(artist)
		})

		it('logs a warn when no performer resolves against artistMap', () => {
			const group = {
				date: { value: dateLD },
				home: [makeConcert()],
				nearby: [],
				away: [],
			}
			// artistMap intentionally has a different artist than the
			// concert's performer — the inner loop finds no match.
			const artistMap = new Map([
				[
					'a-someone-else',
					{
						artist: { id: 'a-someone-else', name: 'X', mbid: '' },
						hype: 'watch' as const,
					},
				],
			])
			sut.toDateGroups([group as never], artistMap)
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining('no performer resolved'),
				expect.objectContaining({ concertId: 'c1' }),
			)
		})

		it('excludes a concert whose localDate is missing', () => {
			const group = {
				date: { value: dateLD },
				home: [makeConcert({ localDate: undefined })],
				nearby: [],
				away: [],
			}
			const artist = { id: 'a-headliner', name: 'Headliner', mbid: '' }
			const artistMap = new Map([
				['a-headliner', { artist, hype: 'watch' as const }],
			])
			const [dg] = sut.toDateGroups([group as never], artistMap)
			expect(dg.home).toHaveLength(0)
		})
	})
})
