import { IRouteContext, IRouter } from '@aurelia/router'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { type SaleBlock, saleBlocksOf } from '../event/event-page'
import { zoneLabel, zoneName } from '../../shared/lib/zoned-time/zone-name'
import { instantOfDateTime } from '../../shared/lib/zoned-time/proto'
import type { WallClock } from '../../shared/lib/zoned-time/zoned-time'
import { IConsoleLanguage } from '../i18n/console-language'
import {
	emptyDateTimeInput,
	instantOfInput,
	toDateTimeInput,
} from '../i18n/wall-input'
import {
	saleZonesOf,
	storedWindowOf,
	wallText,
	zoneOptions,
} from '../model/sale-zone'
import {
	concertTitle,
	eventDay,
	eventStart,
	eventWhen,
	findConcert,
	findEvent,
	paths,
	perAccountLimitOf,
	venueName,
} from '../model/concert-model'
import { type StockView, stockViewsOf } from '../model/stock-model'
import { IClock } from '../services/clock'
import { IOrganizerClient } from '../services/organizer-client'
import { findOverlappingSale } from '../services/sale-window'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import {
	ITicketSaleClient,
	type TicketSale,
} from '../services/ticket-sale-client'
import { ITicketStockClient } from '../services/ticket-stock-client'
import { IBreadcrumbs } from '../shell/breadcrumbs'
import { IConsoleContext } from '../shell/console-context'
import { IPageProgress } from '../shell/page-progress'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { UnsavedChanges } from '../ui/unsaved-changes/unsaved-changes'
import {
	emptyFormModel,
	type FieldError,
	isFormValid,
	type LotterySaleFormErrors,
	type LotterySaleFormModel,
	MAX_WINDOW_DAYS,
	defaultWindow,
	MIN_WINDOW_DAYS,
	toCreateInput,
	validateLotterySaleForm,
} from './lottery-sale-form'

/** The overlap error, naming the other sale and its window. */
export function overlapError(sale: TicketSale): FieldError {
	const window = storedWindowOf(sale)
	return {
		key: 'lotteryEditor.error.overlap',
		params: {
			name: sale.name?.value ?? '',
			start: window.start
				? { wall: window.start, zone: window.zone }
				: undefined,
			end: window.end ? { wall: window.end, zone: window.zone } : undefined,
		},
	}
}

/**
 * Starts a lottery sale for one event (`ticket-sales/new?method=lottery`) or
 * changes one before it opens (`ticket-sales/:saleId/edit`), opened by the
 * sale editor route: the sale's name, its time zone and its window in that zone. It
 * draws from every TicketStock of the event, listed with their seat types,
 * prices and quantities, and the per-account limit is the event's. Opened
 * from the event's Sales tab and back there after saving or leaving; unsaved
 * changes are guarded. While the event is cancelled or unpublished, has no
 * start time or no TicketStock, or the Organizer's business details are
 * incomplete, it shows why instead of the form, as the first-come editor does.
 *
 * A change saves only the window, with SetWindow, and nothing when it did not
 * change.
 */
export class LotterySaleEditorRoute {
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketStocks = resolve(ITicketStockClient)
	private readonly series = resolve(ISeriesClient)
	private readonly organizers = resolve(IOrganizerClient)
	private readonly router = resolve(IRouter)
	private readonly context = resolve(IRouteContext)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly consoleContext = resolve(IConsoleContext)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	public readonly language = resolve(IConsoleLanguage)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('LotterySaleEditorRoute')

	public state:
		| 'loading'
		| 'ready'
		| 'notFound'
		| 'blocked'
		| 'opened'
		| 'error' = 'loading'
	public seriesId = ''
	public eventId = ''
	public saleId = ''
	public title = ''
	public event: Event | undefined
	private concert: AuthoredSeries | undefined
	/** Why no sale can be saved yet, shown instead of the form. */
	public blocks: SaleBlock[] = []
	public model: LotterySaleFormModel = emptyFormModel(new Date())
	public submitted = false
	/**
	 * Catalog key of a message about the whole save that is not about one
	 * field; the template translates it.
	 */
	public saveProblem = ''
	/** The server refused the sale's zone (it is not one of its events' venues'). */
	public zoneRefused = false
	public guard!: UnsavedChanges

	public readonly minWindowDays = MIN_WINDOW_DAYS
	public readonly maxWindowDays = MAX_WINDOW_DAYS
	/** The event's TicketStocks: what the lottery draws from. */
	public stocks: StockView[] = []

	private existingSales: TicketSale[] = []
	private sale: TicketSale | undefined
	private saved = ''
	private abort = new AbortController()

	/**
	 * Opened by the sale editor route under the event: the series, event and
	 * sale ids are in the address of its routes.
	 */
	public binding(): void {
		const params = this.context.getRouteParameters<
			{
				seriesId?: string
				eventId?: string
				saleId?: string
			},
			'parent-first'
		>({ mergeStrategy: 'parent-first' })
		this.seriesId = params.seriesId ?? ''
		this.eventId = params.eventId ?? ''
		this.saleId = params.saleId ?? ''
	}

	public attached(): void {
		void this.progress.track(this.load())
	}

	public detaching(): void {
		this.abort.abort()
	}

	public canUnload(): Promise<boolean> {
		return this.guard?.confirmLeave() ?? Promise.resolve(true)
	}

	public get isChange(): boolean {
		return this.saleId !== ''
	}

	public get editConcertHref(): string {
		return paths.editConcert(this.consoleContext.scope, this.seriesId)
	}

	public get salesHref(): string {
		return paths.sales(this.consoleContext.scope, this.seriesId, this.eventId)
	}

	public get start(): Date | undefined {
		return this.event ? eventStart(this.event) : undefined
	}

	/** The event's date and start time at its Venue, for the header. */
	public get when() {
		return this.event ? eventWhen(this.event) : undefined
	}

	/** The time zones the sale may be in: those of its events' venues. */
	public get zones(): string[] {
		return saleZonesOf(this.saleEvents())
	}

	/**
	 * The events the sale names: those of an existing sale (a tour presale names
	 * several dates), else the one event the editor was opened from.
	 */
	private saleEvents(): Event[] {
		const named = this.sale?.eventIds.map((e) => e.value) ?? []
		const events = named.length
			? (this.concert?.events ?? []).filter((e) =>
					named.includes(e.id?.value ?? ''),
				)
			: []
		return events.length ? events : this.event ? [this.event] : []
	}

	/** True when the sale's zone is a choice between several; one zone is text. */
	public get zoneIsChoice(): boolean {
		return this.zones.length > 1
	}

	public get zoneOptions() {
		return zoneOptions(this.zones, this.language.current)
	}

	/** The name of the sale's zone (`台北`), or ''. */
	public zoneNameOf(zone: string, locale: string): string {
		return zone ? zoneName(zone, locale === 'ja' ? 'ja' : 'en') : ''
	}

	/** The zone's label for the window's fields (`台北時間`), or '' while none is chosen. */
	public zoneLabelOf(zone: string, locale: string): string {
		return zone ? zoneLabel(zone, locale === 'ja' ? 'ja' : 'en') : ''
	}

	/** The member chose a zone: an unset window defaults to 10 days from now there. */
	public zoneChosen(zone: string): void {
		this.model.timeZone = zone
		this.zoneRefused = false
		const { saleStart, saleEnd } = this.model
		if (
			zone &&
			!saleStart.date &&
			!saleStart.time &&
			!saleEnd.date &&
			!saleEnd.time
		) {
			Object.assign(this.model, defaultWindow(new Date(this.clock.now()), zone))
		}
	}

	public get venue(): string {
		return this.event ? venueName(this.event) : ''
	}

	/** The event's per-account limit, across every sale and seat type. */
	public get perAccountLimit(): number {
		return this.event ? perAccountLimitOf(this.event) : 0
	}

	public get isDirty(): boolean {
		return this.state === 'ready' && JSON.stringify(this.model) !== this.saved
	}

	public get errors(): LotterySaleFormErrors {
		const errors = validateLotterySaleForm(this.model, {
			eventStart: this.start ?? null,
		})
		if (this.zoneRefused && !errors.timeZone) {
			errors.timeZone = { key: 'saleEditor.error.zoneRefused' }
		}
		const open = instantOfInput(this.model.saleStart, this.model.timeZone)
		const close = instantOfInput(this.model.saleEnd, this.model.timeZone)
		if (!errors.window && open && close) {
			const other = findOverlappingSale(
				this.existingSales,
				open,
				close,
				this.saleId || undefined,
			)
			if (other) errors.window = overlapError(other)
		}
		return errors
	}

	/** The error of a field once a save was attempted; the field translates it. */
	public error(
		error: FieldError | undefined,
		submitted = this.submitted,
	): FieldError | null {
		// The template passes `submitted` so the binding re-evaluates when it changes.
		if (!submitted || !error) return null
		return { key: error.key, params: this.formatParams(error.params) }
	}

	private formatParams(
		params?: Record<string, unknown>,
	): Record<string, unknown> | undefined {
		if (!params) return params
		const out: Record<string, unknown> = { ...params }
		for (const [k, v] of Object.entries(params)) {
			const moment = v as { wall?: WallClock; zone?: string } | undefined
			if (moment && typeof moment === 'object' && 'wall' in moment) {
				out[k] = moment.wall
					? `${wallText(moment.wall)}${moment.zone ? ` ${zoneLabel(moment.zone, this.language.current)}` : ''}`
					: ''
			}
		}
		return out
	}

	private async load(): Promise<void> {
		this.state = 'loading'
		try {
			const [concerts, organizer, sales, stocks] = await Promise.all([
				this.series.list(this.abort.signal),
				this.organizers.get(this.abort.signal),
				this.ticketSales.listByEvent(this.eventId, this.abort.signal),
				this.ticketStocks.listByEvent(this.eventId, this.abort.signal),
			])
			const concert = findConcert(concerts, this.seriesId)
			this.concert = concert
			this.event = findEvent(concert, this.eventId)
			this.title = concert ? concertTitle(concert) : ''
			this.existingSales = sales.ticketSales
			this.stocks = stockViewsOf(stocks)
			if (!this.event) {
				this.state = 'notFound'
				return
			}
			this.setBreadcrumb()
			this.blocks = saleBlocksOf(this.event, organizer, this.stocks.length)
			if (this.blocks.length > 0) {
				this.state = 'blocked'
				return
			}
			if (this.isChange) {
				this.sale = this.existingSales.find((s) => s.id?.value === this.saleId)
				if (!this.sale) {
					this.state = 'notFound'
					return
				}
				if (this.hasOpened(this.sale)) {
					this.state = 'opened'
					return
				}
				const window = storedWindowOf(this.sale)
				this.model = {
					name: this.sale.name?.value ?? '',
					timeZone: window.zone ?? '',
					saleStart: window.start
						? toDateTimeInput(window.start)
						: emptyDateTimeInput(),
					saleEnd: window.end
						? toDateTimeInput(window.end)
						: emptyDateTimeInput(),
				}
			} else {
				// A zone the events' venues share is the sale's; several leave it to the member.
				this.model = emptyFormModel(
					new Date(this.clock.now()),
					this.zones.length === 1 ? this.zones[0] : '',
				)
			}
			this.saved = JSON.stringify(this.model)
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Lottery editor failed to load', err)
			this.state = 'error'
		}
	}

	private setBreadcrumb(): void {
		const saleName = this.isChange
			? this.existingSales.find((s) => s.id?.value === this.saleId)?.name?.value
			: undefined
		this.breadcrumbs.set([
			{
				labelKey: 'shell.nav.concerts',
				href: paths.concerts(this.consoleContext.scope),
			},
			{
				label: this.title,
				href: paths.concert(this.consoleContext.scope, this.seriesId),
			},
			{
				day: this.event ? eventDay(this.event) : undefined,
				href: this.salesHref,
			},
			saleName ? { label: saleName } : { labelKey: 'lotteryEditor.crumb' },
		])
	}

	private hasOpened(sale: TicketSale): boolean {
		const start = sale.saleStartTime
			? instantOfDateTime(sale.saleStartTime)
			: undefined
		return !!start && start.getTime() <= this.clock.now()
	}

	public async save(): Promise<void> {
		this.submitted = true
		this.saveProblem = ''
		this.zoneRefused = false
		if (!isFormValid(this.errors)) return
		if (this.isChange) await this.saveChange()
		else await this.create()
	}

	private async create(): Promise<void> {
		try {
			await this.ticketSales.create(
				toCreateInput(this.seriesId, this.eventId, this.model),
				this.abort.signal,
			)
			this.saved = JSON.stringify(this.model)
			this.snackbar.show('lotteryEditor.created', {
				name: this.model.name.trim(),
			})
			await this.router.load(this.salesHref)
		} catch (err) {
			this.logger.warn('Lottery not created', err)
			this.failed(err, () => void this.save())
		}
	}

	/** Only the window changes; nothing is sent when it did not (D13). */
	private async saveChange(): Promise<void> {
		const sale = this.sale
		if (!sale) return
		if (this.hasOpened(sale)) {
			this.saveProblem = 'lotteryEditor.openedWhileEditing'
			return
		}
		const input = toCreateInput(this.seriesId, this.eventId, this.model)
		const stored = storedWindowOf(sale)
		const same = (a: WallClock, b?: WallClock) =>
			!!b &&
			a.year === b.year &&
			a.month === b.month &&
			a.day === b.day &&
			a.hour === b.hour &&
			a.minute === b.minute
		const windowChanged =
			input.timeZone !== (stored.zone ?? '') ||
			!same(input.saleStart, stored.start) ||
			!same(input.saleEnd, stored.end)

		if (windowChanged) {
			try {
				const updated = await this.ticketSales.setWindow(
					this.saleId,
					{
						saleStart: input.saleStart,
						saleEnd: input.saleEnd,
						timeZone: input.timeZone,
					},
					this.abort.signal,
				)
				if (updated) {
					sale.saleStartTime = updated.saleStartTime
					sale.saleEndTime = updated.saleEndTime
				}
			} catch (err) {
				this.logger.warn('Window not saved', err)
				this.failed(err, () => void this.save())
				return
			}
		}
		this.saved = JSON.stringify(this.model)
		this.snackbar.show('lotteryEditor.changed')
		await this.router.load(this.salesHref)
	}

	private failed(err: unknown, retry: () => void): void {
		if (err instanceof ConnectError && err.code === Code.InvalidArgument) {
			// The zone is not one of the zones of the events' venues.
			this.zoneRefused = true
			return
		}
		if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
			this.saveProblem = this.isChange
				? 'lotteryEditor.openedWhileEditing'
				: 'lotteryEditor.rejected'
			return
		}
		this.snackbar.showError('lotteryEditor.saveFailed', { retry })
	}
}
