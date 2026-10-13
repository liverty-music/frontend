import { IRouter, type Params } from '@aurelia/router'
import { Visibility } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { ILogger, resolve } from 'aurelia'
import {
	concertTitle,
	eventDay,
	eventId,
	eventStart,
	eventsByDate,
	findConcert,
	isCancelled,
	isDraft,
	isPublished,
	paths,
	performerNames,
	performs,
	publishBadge,
	seriesTypeKey,
	venueName,
	visibilityKey,
} from '../model/concert-model'
import { currentSale, type SaleView, saleViewsOf } from '../model/sale-model'
import { IClock } from '../services/clock'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import { ITicketSaleClient } from '../services/ticket-sale-client'
import { IBreadcrumbs } from '../shell/breadcrumbs'
import { IConsoleContext } from '../shell/console-context'
import { IPageProgress } from '../shell/page-progress'
import type { ConfirmDialog } from '../ui/confirm-dialog/confirm-dialog'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { DataColumn, DataRow } from '../ui/data-list/data-list'
import type { MenuItem } from '../ui/overflow-menu/overflow-menu'

type LoadState = 'loading' | 'ready' | 'notFound' | 'error'

/**
 * One concert, in the M3 supporting pane layout (design D18): its events in
 * date order, each one target opening its event page (the focus pane), and
 * its summary — cover, type, visibility, performers — beside them from 840 px
 * and below them on narrower windows (the supporting pane). The header offers
 * 公開する for the draft dates (filled, the page's main action), 編集 and, in
 * its overflow menu, 公演を中止.
 *
 * It opens under each represented Artist who performs in it, and is not
 * found under any other; its links and breadcrumb keep the Artist of the
 * address (design D1).
 */
export class ConcertRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly router = resolve(IRouter)
	private readonly context = resolve(IConsoleContext)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('ConcertRoute')

	public state: LoadState = 'loading'
	public seriesId = ''
	public concert: AuthoredSeries | undefined
	public readonly columns: DataColumn[] = [
		{ key: 'date', labelKey: 'concert.column.date', primary: true },
		{ key: 'venue', labelKey: 'concert.column.venue' },
		{ key: 'sale', labelKey: 'concert.column.sale', kind: 'status' },
		{
			key: 'state',
			labelKey: 'concert.column.state',
			kind: 'status',
			trailing: true,
		},
	]
	public rows: DataRow[] = []
	public publishDialog!: ConfirmDialog
	public cancelDialog!: ConfirmDialog
	/** Draft dates chosen in the publish dialog, by event id. */
	public chosen: Record<string, boolean> = {}
	public publishing = false
	public cancelling = false

	private sales = new Map<string, SaleView | null>()
	private abort = new AbortController()

	public loading(params: Params): void {
		this.seriesId = params.seriesId ?? ''
	}

	public attached(): void {
		void this.load()
	}

	public detaching(): void {
		this.abort.abort()
	}

	public get title(): string {
		return this.concert ? concertTitle(this.concert) : ''
	}

	public get concertsHref(): string {
		return paths.concerts(this.context.scope)
	}

	public get editHref(): string {
		return paths.editConcert(this.context.scope, this.seriesId)
	}

	public get typeKey(): string {
		return this.concert ? seriesTypeKey(this.concert.series.type) : ''
	}

	public get visibilityKey(): string {
		return this.concert ? visibilityKey(this.concert.series.visibility) : ''
	}

	public get performers(): string[] {
		return this.concert ? performerNames(this.concert) : []
	}

	public get coverUrl(): string {
		return this.concert?.series.coverImage?.large?.value ?? ''
	}

	/** The draft dates, in date order, that 公開する can publish together. */
	public get draftDates(): Array<{
		id: string
		start?: Date
		day?: Date
		venue: string
	}> {
		if (!this.concert) return []
		return eventsByDate(this.concert)
			.filter(isDraft)
			.map((e) => ({
				id: eventId(e),
				start: eventStart(e),
				day: eventDay(e),
				venue: venueName(e),
			}))
	}

	public get canCancelConcert(): boolean {
		return !!this.concert?.events.some((e) => !isCancelled(e))
	}

	/** The header's further actions: 公演を中止, disabled once every date is cancelled. */
	public get menu(): MenuItem[] {
		return [
			{
				id: 'cancel',
				labelKey: 'concert.cancelConcert',
				disabled: !this.canCancelConcert || this.publishing || this.cancelling,
			},
		]
	}

	public onMenu(id: string): void {
		if (id === 'cancel') void this.cancelConcert()
	}

	public get unlisted(): boolean {
		return this.concert?.series.visibility === Visibility.UNLISTED
	}

	public get chosenIds(): string[] {
		return this.draftDates.map((d) => d.id).filter((id) => this.chosen[id])
	}

	/** Publishes the chosen draft dates in one publish: one notification (D14). */
	public async publish(): Promise<void> {
		if (this.publishing || this.draftDates.length === 0) return
		this.chosen = Object.fromEntries(this.draftDates.map((d) => [d.id, true]))
		if (!(await this.publishDialog.ask())) return
		const ids = this.chosenIds
		if (ids.length === 0) return
		this.publishing = true
		try {
			const concert = await this.series.publish(this.seriesId, ids)
			if (concert) this.concert = concert
			else await this.load()
			this.render()
			void this.loadSales()
			this.snackbar.show('concert.datesPublished', { count: ids.length })
		} catch (err) {
			this.logger.warn('Publish failed', err)
			this.snackbar.showError('event.publishFailed')
		} finally {
			this.publishing = false
		}
	}

	/** Cancels every published and draft date in one cancel (D14). */
	public async cancelConcert(): Promise<void> {
		if (this.cancelling || !this.canCancelConcert) return
		if (!(await this.cancelDialog.ask())) return
		const onlyDrafts = !this.concert?.events.some(isPublished)
		this.cancelling = true
		try {
			await this.series.cancel(this.seriesId)
			this.snackbar.show(
				onlyDrafts ? 'concert.draftsRemoved' : 'concert.cancelled',
			)
			if (onlyDrafts) {
				// A concert of drafts only is removed with its dates.
				await this.router.load(this.concertsHref)
				return
			}
			await this.load()
		} catch (err) {
			this.logger.warn('Cancel failed', err)
			this.snackbar.showError('event.cancelFailed')
		} finally {
			this.cancelling = false
		}
	}

	public load(): Promise<void> {
		return this.progress.track(this.read())
	}

	private async read(): Promise<void> {
		this.state = 'loading'
		try {
			const concerts = await this.series.list(this.abort.signal)
			const concert = findConcert(concerts, this.seriesId)
			// Under an Artist who does not perform in it, the concert is not found.
			this.concert =
				concert && performs(concert, this.context.artistId)
					? concert
					: undefined
			if (!this.concert) {
				this.state = 'notFound'
				this.breadcrumbs.set([
					{ labelKey: 'shell.nav.concerts', href: this.concertsHref },
				])
				return
			}
			this.breadcrumbs.set([
				{ labelKey: 'shell.nav.concerts', href: this.concertsHref },
				{ label: this.title },
			])
			this.state = 'ready'
			this.render()
			void this.loadSales()
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Concert unavailable', err)
			this.state = 'error'
		}
	}

	private async loadSales(): Promise<void> {
		const concert = this.concert
		if (!concert) return
		await Promise.all(
			concert.events.filter(isPublished).map(async (event) => {
				try {
					const views = saleViewsOf(
						eventId(event),
						await this.ticketSales.listByEvent(
							eventId(event),
							this.abort.signal,
						),
						this.clock.now(),
					)
					this.sales.set(eventId(event), currentSale(views) ?? null)
				} catch (err) {
					if (!this.abort.signal.aborted)
						this.logger.warn('Sales unavailable', err)
				}
			}),
		)
		this.render()
	}

	/** Rows of catalog keys and values: the list translates them. */
	private render(): void {
		const concert = this.concert
		if (!concert) return
		this.rows = eventsByDate(concert).map((event) => {
			const start = eventStart(event)
			const day = eventDay(event)
			const badge = publishBadge(event.publishState)
			const sale = this.sales.get(eventId(event))
			return {
				id: eventId(event),
				href: paths.event(this.context.scope, this.seriesId, eventId(event)),
				cells: {
					date: start
						? { key: 'format.dateTime', params: { at: start } }
						: day
							? { key: 'concert.dayNoStartTime', params: { day } }
							: '',
					venue: venueName(event),
					sale:
						sale === undefined
							? isPublished(event)
								? undefined
								: { tone: 'neutral', labelKey: 'sale.none' }
							: sale === null
								? { tone: 'neutral', labelKey: 'sale.none' }
								: { tone: sale.tone, labelKey: sale.stateKey },
					state: { tone: badge.tone, labelKey: badge.labelKey },
				},
			}
		})
	}
}
