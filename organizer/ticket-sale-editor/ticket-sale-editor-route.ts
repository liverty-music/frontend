import { IRouteContext, IRouter } from '@aurelia/router'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { TicketSaleMethod } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { type SaleBlock, saleBlocksOf } from '../event/event-page'
import { IConsoleLanguage } from '../i18n/console-language'
import type { FieldError } from '../i18n/field-error'
import { sameJstDateTime, toJstDateTime } from '../i18n/format'
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
	blankFormModel,
	formModelOf,
	isFormValid,
	parseDateTime,
	type TicketSaleFormErrors,
	type TicketSaleFormModel,
	toCreateInput,
	validateTicketSaleForm,
} from './ticket-sale-form'

/**
 * The event's first-come sale: the open one, else the next, else the most
 * recent. One event has at most one first-come sale at a time.
 */
export function firstComeSaleOf(
	sales: readonly TicketSale[],
	eventId: string,
	now: number,
): TicketSale | undefined {
	const timed = sales.flatMap((s) => {
		if (s.method !== TicketSaleMethod.FIRST_COME) return []
		if (!s.eventIds.some((e) => e.value === eventId)) return []
		if (!s.saleStartTime || !s.saleEndTime) return []
		return [
			{
				sale: s,
				start: timestampDate(s.saleStartTime).getTime(),
				end: timestampDate(s.saleEndTime).getTime(),
			},
		]
	})
	const open = timed.find((t) => t.start <= now && now < t.end)
	if (open) return open.sale
	const next = timed
		.filter((t) => t.start > now)
		.sort((a, b) => a.start - b.start)[0]
	if (next) return next.sale
	return [...timed].sort((a, b) => b.end - a.end)[0]?.sale
}

/**
 * Starts the event's first-come sale, or moves its window at any time, in
 * Japan time. The sale sells every TicketStock of the event, listed with
 * their seat types, prices and quantities, and the per-account limit is the
 * event's: neither is set here. Opened from the Sales tab and back there
 * after saving or leaving.
 */
export class TicketSaleEditorRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly organizers = resolve(IOrganizerClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketStocks = resolve(ITicketStockClient)
	private readonly router = resolve(IRouter)
	private readonly context = resolve(IRouteContext)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly consoleContext = resolve(IConsoleContext)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly language = resolve(IConsoleLanguage)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('TicketSaleEditorRoute')

	public state: 'loading' | 'ready' | 'notFound' | 'error' = 'loading'
	public seriesId = ''
	public eventId = ''
	public title = ''
	public event: Event | undefined
	public blocks: SaleBlock[] = []
	public sale: TicketSale | undefined
	public model: TicketSaleFormModel = blankFormModel(null)
	public submitted = false
	/** Catalog key of a message about the whole save; the template translates it. */
	public saveProblem = ''
	public guard!: UnsavedChanges
	/** The event's TicketStocks: what the sale sells. */
	public stocks: StockView[] = []

	private sales: TicketSale[] = []
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
			},
			'parent-first'
		>({ mergeStrategy: 'parent-first' })
		this.seriesId = params.seriesId ?? ''
		this.eventId = params.eventId ?? ''
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

	public get salesHref(): string {
		return paths.sales(this.consoleContext.scope, this.seriesId, this.eventId)
	}

	public get concertsHref(): string {
		return paths.concerts(this.consoleContext.scope)
	}

	public get editConcertHref(): string {
		return paths.editConcert(this.consoleContext.scope, this.seriesId)
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
		return (
			this.state === 'ready' &&
			this.blocks.length === 0 &&
			JSON.stringify(this.model) !== this.saved
		)
	}

	public get errors(): TicketSaleFormErrors {
		const errors = validateTicketSaleForm(this.model, {
			eventStart: this.start ?? null,
		})
		const start = parseDateTime(this.model.saleStart)
		const end = parseDateTime(this.model.saleEnd)
		if (
			!errors.saleStartDate &&
			!errors.saleStartTime &&
			!errors.saleEndDate &&
			!errors.saleEndTime &&
			start &&
			end
		) {
			const other = findOverlappingSale(
				this.sales,
				start,
				end,
				this.sale?.id?.value,
			)
			if (other) {
				errors.saleStartDate = {
					key: 'firstComeEditor.error.overlap',
					params: {
						name: other.name?.value ?? '',
						start: other.saleStartTime
							? timestampDate(other.saleStartTime)
							: undefined,
						end: other.saleEndTime
							? timestampDate(other.saleEndTime)
							: undefined,
					},
				}
			}
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
		const params: Record<string, unknown> = { ...error.params }
		for (const [k, v] of Object.entries(params)) {
			if (v instanceof Date) {
				const at = toJstDateTime(v)
				params[k] = `${at.date} ${at.time}`
			}
		}
		return { key: error.key, params }
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
			if (!concert || !this.event) {
				this.state = 'notFound'
				return
			}
			this.title = concertTitle(concert)
			this.breadcrumbs.set([
				{
					labelKey: 'shell.nav.concerts',
					href: paths.concerts(this.consoleContext.scope),
				},
				{
					label: this.title,
					href: paths.concert(this.consoleContext.scope, this.seriesId),
				},
				{ day: eventDay(this.event), href: this.salesHref },
				{ labelKey: 'firstComeEditor.crumb' },
			])
			this.stocks = stockViewsOf(stocks)
			this.blocks = saleBlocksOf(this.event, organizer, this.stocks.length)
			this.sales = sales.ticketSales
			this.applySale(
				firstComeSaleOf(this.sales, this.eventId, this.clock.now()),
			)
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('First-come editor failed to load', err)
			this.state = 'error'
		}
	}

	public async save(): Promise<void> {
		if (this.blocks.length > 0) return
		this.submitted = true
		this.saveProblem = ''
		if (!isFormValid(this.errors)) return
		try {
			if (this.sale) await this.saveChanges(this.sale)
			else await this.create()
			this.saved = JSON.stringify(this.model)
			this.snackbar.show('firstComeEditor.saved')
			await this.router.load(this.salesHref)
		} catch (err) {
			this.logger.warn('First-come sale not saved', err)
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				this.saveProblem = 'firstComeEditor.rejected'
				return
			}
			this.snackbar.showError('firstComeEditor.saveFailed', {
				retry: () => void this.save(),
			})
		}
	}

	private async create(): Promise<void> {
		const sale = await this.ticketSales.create(
			toCreateInput(this.seriesId, this.eventId, this.model),
			this.abort.signal,
		)
		if (sale) this.sales = [...this.sales, sale]
		this.applySale(sale)
	}

	/** Only the window changes; nothing is sent when it did not. */
	private async saveChanges(sale: TicketSale): Promise<void> {
		const stored = this.storedModel()
		if (
			sameJstDateTime(this.model.saleStart, stored.saleStart) &&
			sameJstDateTime(this.model.saleEnd, stored.saleEnd)
		) {
			return
		}
		const updated =
			(await this.ticketSales.setWindow(
				sale.id?.value ?? '',
				parseDateTime(this.model.saleStart) ?? new Date(0),
				parseDateTime(this.model.saleEnd) ?? new Date(0),
				this.abort.signal,
			)) ?? sale
		this.sales = this.sales.map((s) =>
			s.id?.value === updated.id?.value ? updated : s,
		)
		this.applySale(updated)
	}

	private storedModel(): TicketSaleFormModel {
		const sale = this.sale
		if (!sale) {
			// A value the member saves, in the language of the moment.
			return blankFormModel(
				this.start ?? null,
				this.language.text('firstComeEditor.defaultName'),
			)
		}
		return formModelOf({
			name: sale.name?.value ?? '',
			saleStartTime: sale.saleStartTime
				? timestampDate(sale.saleStartTime)
				: null,
			saleEndTime: sale.saleEndTime ? timestampDate(sale.saleEndTime) : null,
		})
	}

	private applySale(sale: TicketSale | undefined): void {
		this.sale = sale
		this.model = this.storedModel()
		this.saved = JSON.stringify(this.model)
	}
}
