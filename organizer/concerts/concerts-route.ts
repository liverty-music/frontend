import type { NavigationInstruction, Params } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import {
	concertCancelled,
	concertsOf,
	concertTitle,
	eventDay,
	eventId,
	eventsByDate,
	isPublished,
	paths,
	performerNames,
	publishBadge,
	seriesId,
	seriesTypeKey,
	venueName,
} from '../model/concert-model'
import { currentSale, type SaleView, saleViewsOf } from '../model/sale-model'
import { IClock } from '../services/clock'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import { ITicketSaleClient } from '../services/ticket-sale-client'
import { IConsoleContext } from '../shell/console-context'
import type {
	CellText,
	DataColumn,
	DataRow,
	StatusCell,
} from '../ui/data-list/data-list'

type LoadState = 'loading' | 'ready' | 'error' | 'noArtist' | 'notRepresented'

/**
 * Concerts of the Artist in the address: the concerts it performs in
 * (`Concert.artist_ids`, filtered here from `SeriesService.List`) as cards,
 * or a table once the list is 840 px wide, cancelled ones last. Each opens its
 * concert page under that Artist; 公演をつくる opens the editor with the
 * Artist as the first performer. The sale state of each concert comes from its
 * published events' sales, read after the list shows (design D2).
 *
 * Without an Artist in the address (`/organizers/{o}/artists`) the page
 * forwards to the Artist worked on, or says that no Artist is represented yet.
 */
export class ConcertsRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly clock = resolve(IClock)
	public readonly context = resolve(IConsoleContext)
	private readonly logger = resolve(ILogger).scopeTo('ConcertsRoute')

	public state: LoadState = 'loading'
	public concerts: AuthoredSeries[] = []
	public rows: DataRow[] = []
	public readonly columns: DataColumn[] = [
		{ key: 'title', labelKey: 'concerts.column.title', primary: true },
		{ key: 'schedule', labelKey: 'concerts.column.schedule' },
		{ key: 'sale', labelKey: 'concerts.column.sale', kind: 'status' },
		{ key: 'state', labelKey: 'concerts.column.state', kind: 'status' },
	]
	public artistId = ''

	/** The current or next sale of each concert, by series id. */
	private sales = new Map<string, SaleView | null>()
	private abort = new AbortController()

	/** Without an Artist in the address, opens the Artist worked on. */
	public async canLoad(
		params: Params,
	): Promise<boolean | NavigationInstruction> {
		if (params.artistId) return true
		try {
			await this.context.load()
		} catch (err) {
			this.logger.warn('Represented artists unavailable', err)
			return true
		}
		return this.context.artistId ? paths.concerts(this.context.scope) : true
	}

	public loading(params: Params): void {
		this.artistId = params.artistId ?? ''
	}

	public attached(): void {
		void this.load()
	}

	public get newConcertHref(): string {
		return paths.newConcert(this.context.scope)
	}

	public detaching(): void {
		this.abort.abort()
	}

	public async load(): Promise<void> {
		this.state = 'loading'
		try {
			await this.context.load()
			if (!this.artistId) {
				this.state = this.context.artistsKnown ? 'noArtist' : 'error'
				return
			}
			if (!this.context.represents(this.artistId)) {
				this.state = 'notRepresented'
				return
			}
			const concerts = concertsOf(
				await this.series.list(this.abort.signal),
				this.artistId,
			)
			this.concerts = [
				...concerts.filter((c) => !concertCancelled(c)),
				...concerts.filter(concertCancelled),
			]
			this.state = 'ready'
			this.render()
			void this.loadSales()
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Concerts unavailable', err)
			this.state = 'error'
		}
	}

	private async loadSales(): Promise<void> {
		await Promise.all(
			this.concerts.map(async (concert) => {
				const published = concert.events.filter(isPublished)
				if (published.length === 0) {
					this.sales.set(seriesId(concert), null)
					return
				}
				try {
					const now = this.clock.now()
					const views = (
						await Promise.all(
							published.map(async (event) =>
								saleViewsOf(
									eventId(event),
									await this.ticketSales.listByEvent(
										eventId(event),
										this.abort.signal,
									),
									now,
								),
							),
						)
					).flat()
					this.sales.set(seriesId(concert), currentSale(views) ?? null)
				} catch (err) {
					if (this.abort.signal.aborted) return
					this.logger.warn('Sales unavailable', { err })
				}
			}),
		)
		this.render()
	}

	/** Rows of catalog keys and values: the list translates them. */
	private render(): void {
		this.rows = this.concerts.map((concert) => {
			const events = eventsByDate(concert)
			const first = events[0]
			const day = first ? eventDay(first) : undefined
			const dates: CellText | undefined = day
				? events.length > 1
					? {
							key: 'concerts.moreDates',
							params: { day, count: events.length - 1 },
						}
					: { key: 'format.day', params: { day } }
				: undefined
			const venues = new Set(events.map(venueName).filter(Boolean))
			const venue = first ? venueName(first) : ''
			const venueText: CellText =
				venues.size > 1
					? { key: 'concerts.moreVenues', params: { venue } }
					: venue
			const badge = publishBadge(concert.series.publishState)
			const sale = this.sales.get(seriesId(concert))
			const saleCell: StatusCell | undefined =
				sale === undefined
					? undefined
					: sale === null
						? { tone: 'neutral', labelKey: 'sale.none' }
						: { tone: sale.tone, labelKey: sale.stateKey }
			return {
				id: seriesId(concert),
				href: paths.concert(this.context.scope, seriesId(concert)),
				subtitle: [
					{ key: seriesTypeKey(concert.series.type) },
					...performerNames(concert),
				],
				cells: {
					title: concertTitle(concert),
					schedule: [dates, venueText].filter(
						(part): part is CellText => !!part,
					),
					sale: saleCell,
					state: { tone: badge.tone, labelKey: badge.labelKey },
				},
			}
		})
	}
}
