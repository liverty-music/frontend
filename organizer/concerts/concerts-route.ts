import { I18N, Signals } from '@aurelia/i18n'
import { type IDisposable, IEventAggregator, ILogger, resolve } from 'aurelia'
import { toConsoleLocale } from '../i18n/console-language'
import { formatJstDay } from '../i18n/format'
import {
	concertCancelled,
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
import type { DataColumn, DataRow, StatusCell } from '../ui/data-list/data-list'

type LoadState = 'loading' | 'ready' | 'error'

/**
 * Concerts: the Organizer's concerts as cards, or a table once the list is
 * 840 px wide, cancelled ones last. Each opens its concert page; 公演をつくる
 * opens the editor. The sale state of each concert comes from its published
 * events' sales, read after the list shows (design D2).
 */
export class ConcertsRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)
	private readonly clock = resolve(IClock)
	private readonly logger = resolve(ILogger).scopeTo('ConcertsRoute')

	public state: LoadState = 'loading'
	public concerts: AuthoredSeries[] = []
	public rows: DataRow[] = []
	public columns: DataColumn[] = []
	public readonly newConcertHref = paths.newConcert

	/** The current or next sale of each concert, by series id. */
	private sales = new Map<string, SaleView | null>()
	private abort = new AbortController()
	private subscription: IDisposable | null = null

	public attached(): void {
		this.subscription = this.ea.subscribe(Signals.I18N_EA_CHANNEL, () =>
			this.render(),
		)
		void this.load()
	}

	public detaching(): void {
		this.abort.abort()
		this.subscription?.dispose()
	}

	public async load(): Promise<void> {
		this.state = 'loading'
		try {
			const concerts = await this.series.list(this.abort.signal)
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

	private render(): void {
		const t = (key: string, options?: Record<string, unknown>) =>
			this.i18n.tr(key, options)
		const locale = toConsoleLocale(this.i18n.getLocale())
		this.columns = [
			{ key: 'title', label: t('concerts.column.title'), primary: true },
			{ key: 'schedule', label: t('concerts.column.schedule') },
			{ key: 'sale', label: t('concerts.column.sale'), kind: 'status' },
			{ key: 'state', label: t('concerts.column.state'), kind: 'status' },
		]
		this.rows = this.concerts.map((concert) => {
			const events = eventsByDate(concert)
			const first = events[0]
			const day = first ? eventDay(first) : undefined
			const dates = day
				? events.length > 1
					? t('concerts.moreDates', {
							day: formatJstDay(day, locale),
							count: events.length - 1,
						})
					: formatJstDay(day, locale)
				: ''
			const venues = new Set(events.map(venueName).filter(Boolean))
			const venue = first ? venueName(first) : ''
			const venueText =
				venues.size > 1 ? t('concerts.moreVenues', { venue }) : venue
			const badge = publishBadge(concert.series.publishState)
			const sale = this.sales.get(seriesId(concert))
			const saleCell: StatusCell | undefined =
				sale === undefined
					? undefined
					: sale === null
						? { tone: 'neutral', label: t('sale.none') }
						: { tone: sale.tone, label: t(sale.stateKey) }
			return {
				id: seriesId(concert),
				href: paths.concert(seriesId(concert)),
				subtitle: [
					t(seriesTypeKey(concert.series.type)),
					...performerNames(concert),
				].join(' · '),
				cells: {
					title: concertTitle(concert),
					schedule: [dates, venueText].filter(Boolean).join(' · '),
					sale: saleCell,
					state: { tone: badge.tone, label: t(badge.labelKey) },
				},
			}
		})
	}
}
