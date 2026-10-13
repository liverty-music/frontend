import { IRouteContext, IRouter } from '@aurelia/router'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { TicketSaleMethod } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { TicketTypeState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { businessDetailsComplete } from '../event/event-page'
import { IConsoleLanguage } from '../i18n/console-language'
import type { FieldError } from '../i18n/field-error'
import {
	concertTitle,
	eventDay,
	eventStart,
	findConcert,
	findEvent,
	isCancelled,
	isPublished,
	paths,
	venueName,
} from '../model/concert-model'
import { IClock } from '../services/clock'
import { IOrganizerClient } from '../services/organizer-client'
import { findOverlappingSale } from '../services/sale-window'
import { ISeriesClient } from '../services/series-client'
import {
	ITicketSaleClient,
	type TicketSale,
	type TicketType,
} from '../services/ticket-sale-client'
import { ITicketTypeClient } from '../services/ticket-type-client'
import { IBreadcrumbs } from '../shell/breadcrumbs'
import { IConsoleContext } from '../shell/console-context'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { UnsavedChanges } from '../ui/unsaved-changes/unsaved-changes'
import {
	blankFormModel,
	formModelOf,
	isFormValid,
	MAX_PER_ACCOUNT_LIMIT,
	MIN_PER_ACCOUNT_LIMIT,
	parseJstDateTimeLocal,
	type TicketSaleFormErrors,
	type TicketSaleFormModel,
	toCreateInput,
	toJstDateTimeLocal,
	validateTicketSaleForm,
} from './ticket-sale-form'

export type SaleBlock =
	| 'cancelled'
	| 'notPublished'
	| 'noStartTime'
	| 'businessDetails'

const STATE_KEYS: Record<number, string> = {
	[TicketTypeState.NOT_YET_ON_SALE]: 'sale.firstComeState.notYetOnSale',
	[TicketTypeState.ON_SALE]: 'sale.firstComeState.onSale',
	[TicketTypeState.ALL_HELD]: 'sale.firstComeState.allHeld',
	[TicketTypeState.SOLD_OUT]: 'sale.firstComeState.soldOut',
	[TicketTypeState.ENDED]: 'sale.firstComeState.ended',
}

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
		if (!s.ticketTypes.some((t) => t.eventId?.value === eventId)) return []
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
 * Starts the event's first-come sale, or changes it at any time: the window
 * in Japan time, the price (fixed once a ticket is sold or held), the quantity
 * (never below sold plus held) and the per-account limit. Opened from the
 * Sales tab and back there after saving or leaving.
 */
export class TicketSaleEditorRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly organizers = resolve(IOrganizerClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketTypes = resolve(ITicketTypeClient)
	private readonly router = resolve(IRouter)
	private readonly context = resolve(IRouteContext)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly consoleContext = resolve(IConsoleContext)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly language = resolve(IConsoleLanguage)
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

	public readonly minLimit = MIN_PER_ACCOUNT_LIMIT
	public readonly maxLimit = MAX_PER_ACCOUNT_LIMIT

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
		void this.load()
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

	public get ticketType(): TicketType | undefined {
		return this.sale?.ticketTypes.find((t) => t.eventId?.value === this.eventId)
	}

	public get soldCount(): number {
		return this.ticketType?.soldCount ?? 0
	}

	public get heldCount(): number {
		return this.ticketType?.heldCount ?? 0
	}

	public get quantity(): number {
		return this.ticketType?.quantity ?? 0
	}

	/** The price is fixed once a ticket is sold or held. */
	public get priceLocked(): boolean {
		return this.soldCount + this.heldCount > 0
	}

	/** Catalog key of the price field's supporting text. */
	public get priceHintKey(): string {
		return this.priceLocked ? 'firstComeEditor.priceLocked' : ''
	}

	public get stateKey(): string {
		return this.ticketType ? (STATE_KEYS[this.ticketType.state] ?? '') : ''
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
			soldCount: this.soldCount,
			heldCount: this.heldCount,
		})
		const start = parseJstDateTimeLocal(this.model.saleStartTime)
		const end = parseJstDateTimeLocal(this.model.saleEndTime)
		if (!errors.saleStartTime && !errors.saleEndTime && start && end) {
			const other = findOverlappingSale(
				this.sales,
				start,
				end,
				this.sale?.id?.value,
			)
			if (other) {
				errors.saleStartTime = {
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
			if (v instanceof Date) params[k] = toJstDateTimeLocal(v).replace('T', ' ')
		}
		return { key: error.key, params }
	}

	private async load(): Promise<void> {
		this.state = 'loading'
		try {
			const [concerts, organizer, sales] = await Promise.all([
				this.series.list(this.abort.signal),
				this.organizers.get(this.abort.signal),
				this.ticketSales.listByEvent(this.eventId, this.abort.signal),
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
			const blocks: SaleBlock[] = []
			if (isCancelled(this.event)) blocks.push('cancelled')
			else if (!isPublished(this.event)) blocks.push('notPublished')
			if (!this.start) blocks.push('noStartTime')
			if (!businessDetailsComplete(organizer)) blocks.push('businessDetails')
			this.blocks = blocks
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
				await this.refreshCounts()
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

	/** Window first, then the TicketType; each only when it changed. */
	private async saveChanges(sale: TicketSale): Promise<void> {
		const stored = this.storedModel()
		let updated = sale
		if (
			this.model.saleStartTime !== stored.saleStartTime ||
			this.model.saleEndTime !== stored.saleEndTime
		) {
			updated =
				(await this.ticketSales.setWindow(
					sale.id?.value ?? '',
					parseJstDateTimeLocal(this.model.saleStartTime) ?? new Date(0),
					parseJstDateTimeLocal(this.model.saleEndTime) ?? new Date(0),
					this.abort.signal,
				)) ?? updated
		}
		const type = this.ticketType
		if (
			type &&
			(this.model.price.trim() !== stored.price ||
				this.model.quantity.trim() !== stored.quantity ||
				this.model.perAccountLimit.trim() !== stored.perAccountLimit)
		) {
			const changed = await this.ticketTypes.update(
				{
					ticketTypeId: type.id?.value ?? '',
					price: Number(this.model.price.trim()),
					quantity: Number(this.model.quantity.trim()),
					perAccountLimit: Number(this.model.perAccountLimit.trim()),
				},
				this.abort.signal,
			)
			if (changed) {
				updated = {
					...updated,
					ticketTypes: updated.ticketTypes.map((t) =>
						t.id?.value === changed.id?.value ? changed : t,
					),
				}
			}
		}
		this.sales = this.sales.map((s) =>
			s.id?.value === updated.id?.value ? updated : s,
		)
		this.applySale(updated)
	}

	/** After a refusal, re-read the counts: the price lock and quantity floor may have moved. */
	private async refreshCounts(): Promise<void> {
		try {
			const { ticketSales } = await this.ticketSales.listByEvent(this.eventId)
			this.sales = ticketSales
			const sale = this.sale
				? ticketSales.find((s) => s.id?.value === this.sale?.id?.value)
				: undefined
			if (!sale) return
			this.sale = sale
			if (this.priceLocked) {
				this.model.price = (
					this.ticketType?.price?.value ?? BigInt(0)
				).toString()
			}
		} catch (err) {
			this.logger.warn('Refreshing the sale failed', err)
		}
	}

	private storedModel(): TicketSaleFormModel {
		const sale = this.sale
		const type = this.ticketType
		if (!sale || !type) {
			// A value the operator saves, in the language of the moment.
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
			price: type.price?.value ?? BigInt(0),
			quantity: type.quantity ?? 0,
			perAccountLimit: type.perAccountLimit,
		})
	}

	private applySale(sale: TicketSale | undefined): void {
		this.sale = sale
		this.model = this.storedModel()
		this.saved = JSON.stringify(this.model)
	}
}
