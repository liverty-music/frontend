import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { artistHue } from '../../src/adapter/view/artist-color'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const mockConcertRpcClient = {
	listByArtist: vi.fn().mockResolvedValue([]),
	listFollowed: vi.fn().mockResolvedValue([]),
	listByArtists: vi.fn().mockResolvedValue([]),
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

const { ConcertStore, IConcertStore } = await import(
	'../../src/services/concert-store'
)

describe('ConcertStore', () => {
	let sut: InstanceType<typeof ConcertStore>
	let mockLoggerWarn: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.clearAllMocks()
		mockConcertRpcClient.listByArtist.mockResolvedValue([])
		mockConcertRpcClient.listFollowed.mockResolvedValue([])
		mockConcertRpcClient.listByArtists.mockResolvedValue([])

		const mockAuth = createMockAuth({ isAuthenticated: true })

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIOnboardingService, {
				isOnboarding: false,
			}),
			Registration.instance(mockIConcertRpcClient, mockConcertRpcClient),
		)
		container.register(ConcertStore)
		sut = container.get(IConcertStore)
		// The mock ILogger's scopeTo returns the same instance (mockReturnThis),
		// so the scoped logger inside ConcertStore calls the very same
		// warn spy we grab from the container here.
		mockLoggerWarn = (
			container.get(ILogger) as { warn: ReturnType<typeof vi.fn> }
		).warn
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('listByArtist', () => {
		it('should return concerts from the backend', async () => {
			const fakeConcerts = [{ id: 'c1' }, { id: 'c2' }]
			mockConcertRpcClient.listByArtist.mockResolvedValue(fakeConcerts)

			const result = await sut.listByArtist('artist-1')

			expect(result).toEqual(fakeConcerts)
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()

			await sut.listByArtist('artist-1', controller.signal)

			expect(mockConcertRpcClient.listByArtist).toHaveBeenCalledWith(
				'artist-1',
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.listByArtist.mockRejectedValue(
				new Error('rpc error'),
			)

			await expect(sut.listByArtist('artist-1')).rejects.toThrow('rpc error')
		})
	})

	describe('listFollowed', () => {
		it('should delegate to rpcClient when not onboarding', async () => {
			const fakeGroups = [{ date: '2026-03-15' }]
			mockConcertRpcClient.listFollowed.mockResolvedValue(fakeGroups)

			const result = await sut.listFollowed()

			expect(result).toEqual(fakeGroups)
			expect(mockConcertRpcClient.listFollowed).toHaveBeenCalled()
		})

		it('should forward AbortSignal', async () => {
			const controller = new AbortController()
			mockConcertRpcClient.listFollowed.mockResolvedValue([])

			await sut.listFollowed(undefined, controller.signal)

			expect(mockConcertRpcClient.listFollowed).toHaveBeenCalledWith(
				undefined,
				controller.signal,
			)
		})

		it('should rethrow errors', async () => {
			mockConcertRpcClient.listFollowed.mockRejectedValue(
				new Error('rpc error'),
			)

			await expect(sut.listFollowed()).rejects.toThrow('rpc error')
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

	describe('toDateGroups (badges)', () => {
		const dateLD = { year: 2026, month: 3, day: 15 }
		const artist = { id: 'a1', name: 'Band', mbid: '' }
		const artistMap = new Map([['a1', { artist, hype: 'watch' as const }]])

		function group(organizerId?: string) {
			return {
				date: { value: dateLD },
				home: [
					{
						event: {
							id: { value: 'c1' },
							seriesId: { value: 's1' },
							localDate: { value: dateLD },
							venue: { name: { value: 'Venue' } },
						},
						artists: [{ id: { value: 'a1' }, name: { value: 'Band' } }],
						series: {
							id: { value: 's1' },
							title: { value: 'Show' },
							...(organizerId ? { organizerId: { value: organizerId } } : {}),
						},
					},
				],
				nearby: [],
				away: [],
			}
		}

		it('stamps the journey status on a discovered concert', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Tracked concert"
			const [dg] = sut.toDateGroups(
				[group() as never],
				artistMap,
				new Map([['c1', 'applied' as const]]),
			)
			expect(dg.home[0].isFirstParty).toBe(false)
			expect(dg.home[0].journeyStatus).toBe('applied')
		})

		it('leaves a discovered concert without a journey unbadged', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Concert without a journey"
			const [dg] = sut.toDateGroups([group() as never], artistMap, new Map())
			expect(dg.home[0].journeyStatus).toBeUndefined()
		})

		it('stamps the purchased count and no journey on a first-party concert', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "Purchased first-party concert"
			const [dg] = sut.toDateGroups(
				[group('org-1') as never],
				artistMap,
				new Map([['c1', 'applied' as const]]),
				new Map([['c1', 2]]),
			)
			expect(dg.home[0].isFirstParty).toBe(true)
			expect(dg.home[0].purchasedTicketCount).toBe(2)
			expect(dg.home[0].journeyStatus).toBeUndefined()
		})

		it('gives a first-party concert with only a journey no badge', () => {
			// @spec components/infrastructure/fan/web/route/dashboard "First-party concert not purchased"
			const [dg] = sut.toDateGroups(
				[group('org-1') as never],
				artistMap,
				new Map([['c1', 'applied' as const]]),
				new Map(),
			)
			expect(dg.home[0].purchasedTicketCount).toBe(0)
			expect(dg.home[0].journeyStatus).toBeUndefined()
		})
	})

	describe('toDateGroups (fanart enrichment)', () => {
		// @spec components/infrastructure/fan/web/global/live-highway "Dashboard events enriched with fanart"
		it('attaches the fanart of the followed artist, looked up by artist ID, to each LiveEvent', () => {
			const dateLD = { year: 2026, month: 3, day: 15 }
			const fanart = {
				hdMusicLogo: 'https://assets.fanart.tv/hd-logo.png',
				musicLogo: 'https://assets.fanart.tv/logo.png',
				artistBackground: 'https://assets.fanart.tv/background.jpg',
				artistThumb: 'https://assets.fanart.tv/thumb.jpg',
			}
			// The followed-artist map as the dashboard builds it from the
			// FollowService.List response: keyed by artist ID.
			const artistMap = new Map([
				[
					'a-followed',
					{
						artist: { id: 'a-followed', name: 'Support', mbid: '', fanart },
						hype: 'watch' as const,
					},
				],
				[
					'a-plain',
					{
						artist: { id: 'a-plain', name: 'No Art', mbid: '' },
						hype: 'watch' as const,
					},
				],
			])
			const concert = (id: string, performers: string[]) => ({
				event: {
					id: { value: id },
					seriesId: { value: `s-${id}` },
					localDate: { value: dateLD },
					venue: { name: { value: 'Venue' } },
				},
				// The concert payload itself carries no fanart: only IDs and names.
				artists: performers.map((p) => ({
					id: { value: p },
					name: { value: p },
				})),
				series: { id: { value: `s-${id}` }, title: { value: 'Show' } },
			})

			const [dg] = sut.toDateGroups(
				[
					{
						date: { value: dateLD },
						// The followed artist is the second performer on the bill, so
						// the match is by ID, not by position.
						home: [concert('c1', ['a-unfollowed', 'a-followed'])],
						nearby: [concert('c2', ['a-plain'])],
						away: [],
					} as never,
				],
				artistMap,
			)

			expect(dg.home[0].artistId).toBe('a-followed')
			expect(dg.home[0].artist?.fanart).toEqual(fanart)
			// An artist with no fanart leaves the image fields empty (fallback UI).
			expect(dg.nearby[0].artistId).toBe('a-plain')
			expect(dg.nearby[0].artist?.fanart).toBeUndefined()
		})
	})

	describe('toDateGroups (performer resolution)', () => {
		// A Concert as the RPC client resolves it: its Event, its Series and
		// its performing Artists.
		function makeConcert(
			overrides: Record<string, unknown> = {},
			eventOverrides: Record<string, unknown> = {},
		) {
			return {
				event: {
					id: { value: 'c1' },
					seriesId: { value: 's1' },
					localDate: { value: { year: 2026, month: 3, day: 15 } },
					venue: { name: { value: 'Venue' }, adminArea: { value: 'JP-13' } },
					...eventOverrides,
				},
				artists: [
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

		it("carries the resolved artist's hue, computed once from its name", () => {
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
			// The card hands this to CSS as-is, so it has to be the same hue the
			// name always maps to — the colour identity a fan learns.
			expect(dg.home[0].artistHue).toBe(artistHue('Headliner'))
		})

		it('picks the first MATCHED performer, not necessarily performers[0]', () => {
			// performers[0] is an unfollowed headliner; performers[1] is the
			// followed support act. The resolver must skip the headliner and
			// resolve the support act so the entity's artist context is
			// internally consistent.
			const concert = makeConcert({
				artists: [
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
			// One batched warn per group covering all unresolved concerts
			// (not one per concert) — a systematic mismatch would otherwise
			// produce O(N) entries per page load. Each entry is tagged with
			// the lane it failed in so on-call can tell follower-lane
			// mismatches apart from proximity-lane noise.
			expect(mockLoggerWarn).toHaveBeenCalledWith(
				expect.stringContaining('no performer resolved'),
				expect.objectContaining({
					count: 1,
					concertIds: ['c1'],
					lanes: ['home'],
				}),
			)
		})

		it('excludes a concert whose localDate is missing', () => {
			const group = {
				date: { value: dateLD },
				home: [makeConcert({}, { localDate: undefined })],
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
