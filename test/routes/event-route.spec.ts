import { ConcertSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IConcertRpcClient,
	type ProtoConcert,
} from '../../src/adapter/rpc/client/concert-client'
import type { Artist } from '../../src/entities/artist'
import { EventRoute } from '../../src/routes/event/event-route'
import { IAuthService } from '../../src/services/auth-service'
import { IFollowStore } from '../../src/services/follow-store'
import { IPurchasedTicketStore } from '../../src/services/purchased-ticket-store'
import { IUserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

const EVENT_ID = '019a0000-0000-7000-8000-0000000000e1'
const SERIES_ID = '019a0000-0000-7000-8000-0000000000a1'
const ARTIST_ID = '019a0000-0000-7000-8000-0000000000b1'

/** An instant at the given Japan-time hour on a 2026-11 day. */
function jst(day: number, hour: number, minute = 0): Date {
	return new Date(Date.UTC(2026, 10, day, hour - 9, minute))
}

interface ConcertOpts {
	id?: string
	day?: number
	open?: Date
	start?: Date
	cover?: boolean
	state?: PublishState
	title?: string
}

function protoConcert(o: ConcertOpts = {}): ProtoConcert {
	const day = o.day ?? 20
	return create(ConcertSchema, {
		id: { value: o.id ?? EVENT_ID },
		localDate: { value: { year: 2026, month: 11, day } },
		openTime: o.open ? { value: timestampFromDate(o.open) } : undefined,
		startTime: o.start ? { value: timestampFromDate(o.start) } : undefined,
		listedVenueName: { value: 'Shibuya WWW' },
		venue: { name: { value: 'WWW' }, adminArea: { value: 'JP-13' } },
		performers: [{ id: { value: ARTIST_ID }, name: { value: 'The Band' } }],
		series: {
			id: { value: SERIES_ID },
			title: { value: o.title ?? 'ONE MAN LIVE' },
			description: { value: '二夜連続公演' },
			organizerId: { value: 'org-1' },
			publishState: o.state ?? PublishState.PUBLISHED,
			media: o.cover
				? {
						id: { value: 'm1' },
						attributes: {
							thumb: { value: 'https://media.example/thumb.webp' },
							large: { value: 'https://media.example/large.webp' },
						},
					}
				: undefined,
		},
	})
}

function makeFollowStore() {
	const store = {
		followedArtists: [] as Artist[],
		get followedIds(): ReadonlySet<string> {
			return new Set(store.followedArtists.map((a) => a.id))
		},
		follow: vi.fn(async (artist: Artist) => {
			store.followedArtists = [...store.followedArtists, artist]
		}),
		listFollowed: vi.fn(async () => []),
		unfollow: vi.fn(async (id: string) => {
			store.followedArtists = store.followedArtists.filter((a) => a.id !== id)
		}),
	}
	return store
}

function makePurchasedStore(counts = new Map<string, number>()) {
	return {
		countByEvent: counts,
		countFor: (id: string | undefined) => (id ? (counts.get(id) ?? 0) : 0),
		load: vi.fn().mockResolvedValue(counts),
	}
}

describe('EventRoute', () => {
	let concertClient: {
		get: ReturnType<typeof vi.fn>
		listBySeries: ReturnType<typeof vi.fn>
	}
	let auth: ReturnType<typeof createMockAuth>
	let follow: ReturnType<typeof makeFollowStore>
	let purchased: ReturnType<typeof makePurchasedStore>
	let userStore: { currentLanguage: string }

	function build(): EventRoute {
		const container = createTestContainer(
			Registration.instance(IConcertRpcClient, concertClient),
			Registration.instance(IAuthService, auth),
			Registration.instance(IFollowStore, follow),
			Registration.instance(IPurchasedTicketStore, purchased),
			Registration.instance(IUserStore, userStore),
		)
		container.register(EventRoute)
		return container.get(EventRoute)
	}

	async function open(sut: EventRoute, id = EVENT_ID): Promise<void> {
		sut.loading({ id })
		await vi.waitFor(() => expect(sut.state).not.toBe('loading'))
		// Let the non-blocking dates and ticket reads settle.
		await new Promise((r) => setTimeout(r, 0))
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(jst(1, 12))
		concertClient = {
			get: vi.fn().mockResolvedValue(protoConcert()),
			listBySeries: vi.fn().mockResolvedValue([protoConcert()]),
		}
		auth = createMockAuth({ isAuthenticated: false })
		follow = makeFollowStore()
		purchased = makePurchasedStore()
		userStore = { currentLanguage: 'ja' }
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('loading', () => {
		it('shows the event to a guest without asking to sign in', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest opens a shared link"
			const sut = build()
			await open(sut)

			expect(concertClient.get).toHaveBeenCalledWith(
				EVENT_ID,
				expect.any(AbortSignal),
			)
			expect(concertClient.listBySeries).toHaveBeenCalledWith(
				SERIES_ID,
				expect.any(AbortSignal),
			)
			expect(sut.state).toBe('ready')
			expect(sut.event?.title).toBe('ONE MAN LIVE')
			expect(sut.event?.performers.map((p) => p.name)).toEqual(['The Band'])
			expect(sut.event?.venueName).toBe('Shibuya WWW')
			expect(sut.prefecture).toBe('東京都')
			expect(sut.mapsUrl).toContain(encodeURIComponent('Shibuya WWW 東京都'))
			expect(auth.signIn).not.toHaveBeenCalled()
			expect(auth.signUp).not.toHaveBeenCalled()
			// A guest has no tickets to read.
			expect(purchased.load).not.toHaveBeenCalled()
		})

		it('does not wait for the Series dates before showing the event', async () => {
			concertClient.listBySeries.mockReturnValue(new Promise(() => {}))
			const sut = build()
			sut.loading({ id: EVENT_ID })
			await vi.waitFor(() => expect(sut.state).toBe('ready'))
			expect(sut.seriesEvents).toEqual([])
		})
	})

	describe('what the page shows', () => {
		it('uses the cover image when the Series has one', async () => {
			concertClient.get.mockResolvedValue(protoConcert({ cover: true }))
			const sut = build()
			await open(sut)
			expect(sut.event?.coverUrl).toBe('https://media.example/large.webp')
		})

		it('shows the brand placeholder without a cover image', async () => {
			// @spec components/infrastructure/fan/web/route/event "Event without a cover image"
			const sut = build()
			await open(sut)
			expect(sut.event?.coverUrl).toBe('')
		})

		it('shows OPEN without START when no start time is announced', async () => {
			// @spec components/infrastructure/fan/web/route/event "Start time not announced"
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18, 30) }),
			)
			const sut = build()
			await open(sut)
			expect(sut.openTimeLabel).toBe('18:30')
			expect(sut.startTimeLabel).toBe('')
		})

		it('writes times in Japan time', async () => {
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18), start: jst(20, 19) }),
			)
			const sut = build()
			await open(sut)
			expect(sut.openTimeLabel).toBe('18:00')
			expect(sut.startTimeLabel).toBe('19:00')
		})

		it('keeps organizer text as entered and localizes labels in English', async () => {
			// @spec components/infrastructure/fan/web/route/event "English display language"
			userStore.currentLanguage = 'en'
			concertClient.get.mockResolvedValue(
				protoConcert({ title: '二夜連続ワンマン' }),
			)
			const sut = build()
			await open(sut)
			expect(sut.event?.title).toBe('二夜連続ワンマン')
			expect(sut.dateLabel).toBe('Fri, November 20, 2026')
			expect(sut.prefecture).toBe('Tokyo')
		})

		it('writes the date with weekday in Japanese', async () => {
			const sut = build()
			await open(sut)
			expect(sut.dateLabel).toBe('2026年11月20日(金)')
		})
	})

	describe('following', () => {
		it('follows the performer as a guest and shows it as followed', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest follows the artist"
			const sut = build()
			await open(sut)
			const performer = sut.event!.performers[0]
			expect(sut.isFollowed(performer)).toBe(false)

			await sut.toggleFollow(performer)

			// FollowStore keeps a guest's follows locally and migrates them into
			// the account on sign-up (GuestMigrationRequested).
			expect(follow.follow).toHaveBeenCalledWith({
				id: ARTIST_ID,
				name: 'The Band',
				mbid: '',
			})
			expect(sut.isFollowed(performer)).toBe(true)
		})

		it("loads a signed-in fan's follows so a followed performer shows as followed", async () => {
			auth = createMockAuth({ isAuthenticated: true })
			follow.listFollowed.mockImplementation(async () => {
				follow.followedArtists = [{ id: ARTIST_ID, name: 'The Band', mbid: '' }]
				return []
			})
			const sut = build()
			await open(sut)

			expect(follow.listFollowed).toHaveBeenCalled()
			expect(sut.followedIds.has(ARTIST_ID)).toBe(true)
		})

		it('ignores a follow tap until the follows have loaded', async () => {
			let release: () => void = () => {}
			follow.listFollowed.mockReturnValue(
				new Promise((r) => {
					release = () => r([])
				}),
			)
			const sut = build()
			sut.loading({ id: EVENT_ID })
			await vi.waitFor(() => expect(sut.state).toBe('ready'))

			expect(sut.followsLoaded).toBe(false)
			await sut.toggleFollow(sut.event!.performers[0])
			expect(follow.follow).not.toHaveBeenCalled()

			release()
			await vi.waitFor(() => expect(sut.followsLoaded).toBe(true))
		})

		it('unfollows a followed performer', async () => {
			follow.followedArtists = [{ id: ARTIST_ID, name: 'The Band', mbid: '' }]
			const sut = build()
			await open(sut)
			await sut.toggleFollow(sut.event!.performers[0])
			expect(follow.unfollow).toHaveBeenCalledWith(ARTIST_ID)
		})
	})

	describe('date tabs', () => {
		it('shows a tab per date of a two-day run, the displayed one selected', async () => {
			// @spec components/infrastructure/fan/web/route/event "Two-day run"
			const day2 = '019a0000-0000-7000-8000-0000000000e2'
			concertClient.listBySeries.mockResolvedValue([
				protoConcert({ day: 20 }),
				protoConcert({ id: day2, day: 21 }),
			])
			const sut = build()
			await open(sut)

			expect(sut.dateNav).toBe('tabs')
			expect(sut.dateTabs).toEqual([
				{ id: EVENT_ID, label: '11/20(金)', selected: true },
				{ id: day2, label: '11/21(土)', selected: false },
			])
		})

		it('lists the other dates of a six-stop tour instead of tabs', async () => {
			// @spec components/infrastructure/fan/web/route/event "Six-stop tour"
			concertClient.listBySeries.mockResolvedValue(
				[20, 21, 22, 23, 24, 25].map((day, i) =>
					protoConcert({ id: i === 0 ? EVENT_ID : `ev-${day}`, day }),
				),
			)
			const sut = build()
			await open(sut)

			expect(sut.dateNav).toBe('list')
			expect(sut.otherDates.map((d) => d.id)).toEqual([
				'ev-21',
				'ev-22',
				'ev-23',
				'ev-24',
				'ev-25',
			])
		})

		it('shows neither for a single date', async () => {
			const sut = build()
			await open(sut)
			expect(sut.dateNav).toBe('none')
		})
	})

	describe('ticket section', () => {
		it('says how many tickets a signed-in fan holds and links to Tickets', async () => {
			// @spec components/infrastructure/fan/web/route/event "Fan holding two tickets"
			auth = createMockAuth({ isAuthenticated: true })
			purchased = makePurchasedStore(new Map([[EVENT_ID, 2]]))
			const sut = build()
			await open(sut)

			expect(purchased.load).toHaveBeenCalled()
			expect(sut.showTicketSection).toBe(true)
			expect(sut.purchasedCount).toBe(2)
		})

		it('shows no purchased line when the only ticket is voided', async () => {
			// @spec components/infrastructure/fan/web/route/event "Voided tickets are not counted"
			// countIssuedByEvent (purchased-ticket-store.spec) leaves voided
			// tickets out of the counts the page reads.
			auth = createMockAuth({ isAuthenticated: true })
			purchased = makePurchasedStore(new Map())
			const sut = build()
			await open(sut)
			expect(sut.purchasedCount).toBe(0)
		})

		it('starts sign-up that returns to this page as an event-page sign-up', async () => {
			// @spec components/infrastructure/fan/web/route/event "Guest signs up to buy"
			const sut = build()
			await open(sut)
			expect(sut.isGuest).toBe(true)

			await sut.signUp()

			expect(auth.signUp).toHaveBeenCalledWith({
				origin: 'event-page',
				returnTo: `/events/${EVENT_ID}`,
			})
		})
	})

	describe('states', () => {
		it('shows the cancelled banner and offers nothing for sale', async () => {
			// @spec components/infrastructure/fan/web/route/event "Shared link after cancellation"
			concertClient.get.mockResolvedValue(
				protoConcert({ state: PublishState.CANCELLED }),
			)
			const sut = build()
			await open(sut)

			expect(sut.state).toBe('ready')
			expect(sut.isCancelled).toBe(true)
			expect(sut.otherConcertsUrl).toBe(`/dashboard?artists=${ARTIST_ID}`)
		})

		it('says the event has ended the day after the show, with no ticket section', async () => {
			// @spec components/infrastructure/fan/web/route/event "Day after the show"
			// 2026-11-21 00:30 in Japan is still 2026-11-20 in UTC.
			vi.setSystemTime(jst(21, 0, 30))
			const sut = build()
			await open(sut)

			expect(sut.isEnded).toBe(true)
			expect(sut.showTicketSection).toBe(false)
		})

		it('is not ended on the day of the show in Japan', async () => {
			vi.setSystemTime(jst(20, 23, 30))
			const sut = build()
			await open(sut)
			expect(sut.isEnded).toBe(false)
		})

		it('shows the not-found view for an event without a page', async () => {
			// @spec components/infrastructure/fan/web/route/event "Unlisted event"
			concertClient.get.mockRejectedValue(
				new ConnectError('event page not found', Code.NotFound),
			)
			const sut = build()
			await open(sut)
			expect(sut.state).toBe('not-found')
			expect(sut.event).toBeNull()
		})

		it('offers a retry on a network failure, and retrying loads the event', async () => {
			// @spec components/infrastructure/fan/web/route/event "Network failure"
			concertClient.get.mockRejectedValueOnce(
				new ConnectError('unavailable', Code.Unavailable),
			)
			const sut = build()
			await open(sut)
			expect(sut.state).toBe('error')

			sut.retry()
			await vi.waitFor(() => expect(sut.state).toBe('ready'))
			expect(sut.event?.id).toBe(EVENT_ID)
		})
	})

	describe('share and calendar', () => {
		it('shares the canonical event URL without any query', async () => {
			window.history.replaceState(null, '', `/events/${EVENT_ID}?ref=member-a`)
			const share = vi.fn().mockResolvedValue(undefined)
			Object.assign(navigator, { share })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(share).toHaveBeenCalledWith({
				title: 'ONE MAN LIVE',
				url: `${window.location.origin}/events/${EVENT_ID}`,
			})
			Reflect.deleteProperty(navigator, 'share')
		})

		it('copies the link where the Web Share API is missing', async () => {
			const writeText = vi.fn().mockResolvedValue(undefined)
			Object.assign(navigator, { clipboard: { writeText } })
			const sut = build()
			await open(sut)

			await sut.share()

			expect(writeText).toHaveBeenCalledWith(
				`${window.location.origin}/events/${EVENT_ID}`,
			)
		})

		it('downloads an .ics carrying the event start', async () => {
			concertClient.get.mockResolvedValue(
				protoConcert({ open: jst(20, 18), start: jst(20, 19) }),
			)
			const blobs: Blob[] = []
			const createObjectURL = vi.fn((b: Blob) => {
				blobs.push(b)
				return 'blob:ics'
			})
			Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, 'click')
				.mockImplementation(() => {})
			const sut = build()
			await open(sut)

			sut.addToCalendar()

			expect(click).toHaveBeenCalled()
			const ics = await blobs[0].text()
			// 19:00 in Japan is 10:00 UTC.
			expect(ics).toContain('DTSTART:20261120T100000Z')
			expect(ics).toContain('SUMMARY:ONE MAN LIVE')
			expect(ics).toContain(`URL:${window.location.origin}/events/${EVENT_ID}`)
		})
	})
})
