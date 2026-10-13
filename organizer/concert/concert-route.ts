import { I18N, Signals } from '@aurelia/i18n'
import { IRouter, type Params } from '@aurelia/router'
import {
	PublishState,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { type IDisposable, IEventAggregator, ILogger, resolve } from 'aurelia'
import { toConsoleLocale } from '../i18n/console-language'
import { formatJstDateTime, formatJstDay } from '../i18n/format'
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
import type { ConfirmDialog } from '../ui/confirm-dialog/confirm-dialog'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { DataColumn, DataRow } from '../ui/data-list/data-list'

type LoadState = 'loading' | 'ready' | 'notFound' | 'error'

/**
 * One concert: its summary and performers with 編集, the share link of a
 * published UNLISTED concert, and its events in date order, each opening its
 * event page.
 */
export class ConcertRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly snackbar = resolve(ISnackbar)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)
	private readonly clock = resolve(IClock)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('ConcertRoute')

	public state: LoadState = 'loading'
	public seriesId = ''
	public concert: AuthoredSeries | undefined
	public columns: DataColumn[] = []
	public rows: DataRow[] = []
	public shareUrl = ''
	public shareDialog!: ConfirmDialog
	public publishDialog!: ConfirmDialog
	public cancelDialog!: ConfirmDialog
	/** Draft dates chosen in the publish dialog, by event id. */
	public chosen: Record<string, boolean> = {}
	public publishing = false
	public cancelling = false
	public readonly concertsHref = paths.concerts

	private sales = new Map<string, SaleView | null>()
	private abort = new AbortController()
	private subscription: IDisposable | null = null

	public loading(params: Params): void {
		this.seriesId = params.seriesId ?? ''
	}

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

	public get title(): string {
		return this.concert ? concertTitle(this.concert) : ''
	}

	public get editHref(): string {
		return paths.editConcert(this.seriesId)
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

	/** A published UNLISTED concert is opened by fans only through its share link. */
	public get offersShareLink(): boolean {
		return (
			this.concert?.series.visibility === Visibility.UNLISTED &&
			this.concert.series.publishState === PublishState.PUBLISHED
		)
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
			this.snackbar.show(
				this.i18n.tr('concert.datesPublished', { count: ids.length }),
			)
		} catch (err) {
			this.logger.warn('Publish failed', err)
			this.snackbar.showError(this.i18n.tr('event.publishFailed'))
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
				this.i18n.tr(
					onlyDrafts ? 'concert.draftsRemoved' : 'concert.cancelled',
				),
			)
			if (onlyDrafts) {
				// A concert of drafts only is removed with its dates.
				await this.router.load(paths.concerts)
				return
			}
			await this.load()
		} catch (err) {
			this.logger.warn('Cancel failed', err)
			this.snackbar.showError(this.i18n.tr('event.cancelFailed'))
		} finally {
			this.cancelling = false
		}
	}

	public async load(): Promise<void> {
		this.state = 'loading'
		try {
			const concerts = await this.series.list(this.abort.signal)
			this.concert = findConcert(concerts, this.seriesId)
			if (!this.concert) {
				this.state = 'notFound'
				this.breadcrumbs.set([
					{ labelKey: 'shell.nav.concerts', href: paths.concerts },
				])
				return
			}
			this.breadcrumbs.set([
				{ labelKey: 'shell.nav.concerts', href: paths.concerts },
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

	public async createShareLink(): Promise<void> {
		if (!(await this.shareDialog.ask())) return
		try {
			this.shareUrl =
				(await this.series.regenerateShareUrl(
					this.seriesId,
					this.abort.signal,
				)) ?? ''
			this.snackbar.show(this.i18n.tr('concert.shareCreated'))
		} catch (err) {
			this.logger.warn('Share link not created', err)
			this.snackbar.showError(this.i18n.tr('concert.shareFailed'), {
				label: this.i18n.tr('common.retry'),
				callback: () => void this.retryShareLink(),
			})
		}
	}

	/** Retry skips the question: the operator already confirmed. */
	private async retryShareLink(): Promise<void> {
		try {
			this.shareUrl =
				(await this.series.regenerateShareUrl(
					this.seriesId,
					this.abort.signal,
				)) ?? ''
			this.snackbar.show(this.i18n.tr('concert.shareCreated'))
		} catch (err) {
			this.logger.warn('Share link not created', err)
			this.snackbar.showError(this.i18n.tr('concert.shareFailed'))
		}
	}

	private render(): void {
		const concert = this.concert
		if (!concert) return
		const t = (key: string) => this.i18n.tr(key)
		const locale = toConsoleLocale(this.i18n.getLocale())
		this.columns = [
			{ key: 'date', label: t('concert.column.date'), primary: true },
			{ key: 'venue', label: t('concert.column.venue') },
			{ key: 'sale', label: t('concert.column.sale'), kind: 'status' },
			{ key: 'state', label: t('concert.column.state'), kind: 'status' },
		]
		this.rows = eventsByDate(concert).map((event) => {
			const start = eventStart(event)
			const day = eventDay(event)
			const badge = publishBadge(event.publishState)
			const sale = this.sales.get(eventId(event))
			return {
				id: eventId(event),
				href: paths.event(this.seriesId, eventId(event)),
				cells: {
					date: start
						? formatJstDateTime(start, locale)
						: day
							? `${formatJstDay(day, locale)} · ${t('event.noStartTime')}`
							: '',
					venue: venueName(event),
					sale:
						sale === undefined
							? isPublished(event)
								? undefined
								: { tone: 'neutral', label: t('sale.none') }
							: sale === null
								? { tone: 'neutral', label: t('sale.none') }
								: { tone: sale.tone, label: t(sale.stateKey) },
					state: { tone: badge.tone, label: t(badge.labelKey) },
				},
			}
		})
	}
}
