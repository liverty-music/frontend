import { IRouteContext, IRouter } from '@aurelia/router'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { type SaleBlock, saleBlocksOf } from '../event/event-page'
import { emptyJstDateTime } from '../i18n/format'
import {
	concertTitle,
	eventDay,
	eventStart,
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
import { ISeriesClient } from '../services/series-client'
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
	MIN_WINDOW_DAYS,
	parseDateTime,
	toCreateInput,
	toDateTime,
	validateLotterySaleForm,
} from './lottery-sale-form'

/** The overlap error, naming the other sale and its window. */
export function overlapError(sale: TicketSale): FieldError {
	return {
		key: 'lotteryEditor.error.overlap',
		params: {
			name: sale.name?.value ?? '',
			start: sale.saleStartTime ? timestampDate(sale.saleStartTime) : undefined,
			end: sale.saleEndTime ? timestampDate(sale.saleEndTime) : undefined,
		},
	}
}

/**
 * Starts a lottery sale for one event (`ticket-sales/new?method=lottery`) or
 * changes one before it opens (`ticket-sales/:saleId/edit`), opened by the
 * sale editor route: the sale's name and its window in Japan time. It
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
	/** Why no sale can be saved yet, shown instead of the form. */
	public blocks: SaleBlock[] = []
	public model: LotterySaleFormModel = emptyFormModel(new Date())
	public submitted = false
	/**
	 * Catalog key of a message about the whole save that is not about one
	 * field; the template translates it.
	 */
	public saveProblem = ''
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
		const open = parseDateTime(this.model.saleStart)
		const close = parseDateTime(this.model.saleEnd)
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
			if (v instanceof Date) {
				const at = toDateTime(v)
				out[k] = `${at.date} ${at.time}`
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
				this.model = {
					name: this.sale.name?.value ?? '',
					saleStart: this.sale.saleStartTime
						? toDateTime(timestampDate(this.sale.saleStartTime))
						: emptyJstDateTime(),
					saleEnd: this.sale.saleEndTime
						? toDateTime(timestampDate(this.sale.saleEndTime))
						: emptyJstDateTime(),
				}
			} else {
				this.model = emptyFormModel(new Date(this.clock.now()))
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
		return (
			!!sale.saleStartTime &&
			timestampDate(sale.saleStartTime).getTime() <= this.clock.now()
		)
	}

	public async save(): Promise<void> {
		this.submitted = true
		this.saveProblem = ''
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
		const windowChanged =
			input.saleStartTime.getTime() !==
				(sale.saleStartTime
					? timestampDate(sale.saleStartTime).getTime()
					: 0) ||
			input.saleEndTime.getTime() !==
				(sale.saleEndTime ? timestampDate(sale.saleEndTime).getTime() : 0)

		if (windowChanged) {
			try {
				const updated = await this.ticketSales.setWindow(
					this.saleId,
					input.saleStartTime,
					input.saleEndTime,
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
		if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
			this.saveProblem = this.isChange
				? 'lotteryEditor.openedWhileEditing'
				: 'lotteryEditor.rejected'
			return
		}
		this.snackbar.showError('lotteryEditor.saveFailed', { retry })
	}
}
