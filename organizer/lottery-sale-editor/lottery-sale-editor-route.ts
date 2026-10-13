import { IRouteContext, IRouter } from '@aurelia/router'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import {
	concertTitle,
	eventDay,
	eventStart,
	findConcert,
	findEvent,
	paths,
	venueName,
} from '../model/concert-model'
import { IClock } from '../services/clock'
import { findOverlappingSale } from '../services/sale-window'
import { ISeriesClient } from '../services/series-client'
import {
	ITicketSaleClient,
	type TicketSale,
} from '../services/ticket-sale-client'
import { ITicketTypeClient } from '../services/ticket-type-client'
import { IBreadcrumbs } from '../shell/breadcrumbs'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { UnsavedChanges } from '../ui/unsaved-changes/unsaved-changes'
import {
	emptyFormModel,
	type FieldError,
	isFormValid,
	type LotterySaleFormErrors,
	type LotterySaleFormModel,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	parseDateTimeLocal,
	toCreateInput,
	toDateTimeLocal,
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
 * Starts a lottery sale for one event (`sales/lottery/new`) or changes one
 * before it opens (`sales/lottery/:saleId`): the window in Japan time, the
 * price, the quantity and the per-account limit. Opened from the event's Sales
 * tab and back there after saving or leaving; unsaved changes are guarded.
 *
 * A change saves the window with SetWindow and the TicketType with Update,
 * skipping a call whose values did not change. When the second call fails the
 * editor stays open, says which part was not saved, and offers 再試行 (D13).
 */
export class LotterySaleEditorRoute {
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketTypes = resolve(ITicketTypeClient)
	private readonly series = resolve(ISeriesClient)
	private readonly router = resolve(IRouter)
	private readonly context = resolve(IRouteContext)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly logger = resolve(ILogger).scopeTo('LotterySaleEditorRoute')

	public state:
		| 'loading'
		| 'ready'
		| 'notFound'
		| 'noStartTime'
		| 'opened'
		| 'error' = 'loading'
	public seriesId = ''
	public eventId = ''
	public saleId = ''
	public title = ''
	public event: Event | undefined
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
	public readonly maxLimit = MAX_PER_ACCOUNT_LIMIT

	private existingSales: TicketSale[] = []
	private sale: TicketSale | undefined
	private saved = ''
	private abort = new AbortController()

	/** A child route of the event: the series and event ids are the parent's. */
	public loading(): void {
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
		void this.load()
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

	public get salesHref(): string {
		return paths.sales(this.seriesId, this.eventId)
	}

	public get start(): Date | undefined {
		return this.event ? eventStart(this.event) : undefined
	}

	public get venue(): string {
		return this.event ? venueName(this.event) : ''
	}

	public get isDirty(): boolean {
		return this.state === 'ready' && JSON.stringify(this.model) !== this.saved
	}

	public get errors(): LotterySaleFormErrors {
		const errors = validateLotterySaleForm(this.model, {
			eventStart: this.start ?? null,
		})
		const open = parseDateTimeLocal(this.model.saleStartTime)
		const close = parseDateTimeLocal(this.model.saleEndTime)
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
			if (v instanceof Date) out[k] = toDateTimeLocal(v).replace('T', ' ')
		}
		return out
	}

	private async load(): Promise<void> {
		this.state = 'loading'
		try {
			const [concerts, sales] = await Promise.all([
				this.series.list(this.abort.signal),
				this.ticketSales.listByEvent(this.eventId, this.abort.signal),
			])
			const concert = findConcert(concerts, this.seriesId)
			this.event = findEvent(concert, this.eventId)
			this.title = concert ? concertTitle(concert) : ''
			this.existingSales = sales.ticketSales
			if (!this.event) {
				this.state = 'notFound'
				return
			}
			this.setBreadcrumb()
			if (!this.start) {
				this.state = 'noStartTime'
				return
			}
			if (this.isChange) {
				this.sale = this.existingSales.find((s) => s.id?.value === this.saleId)
				const type = this.sale?.ticketTypes.find(
					(t) => t.eventId?.value === this.eventId,
				)
				if (!this.sale || !type) {
					this.state = 'notFound'
					return
				}
				if (this.hasOpened(this.sale)) {
					this.state = 'opened'
					return
				}
				this.model = {
					name: this.sale.name?.value ?? '',
					saleStartTime: this.sale.saleStartTime
						? toDateTimeLocal(timestampDate(this.sale.saleStartTime))
						: '',
					saleEndTime: this.sale.saleEndTime
						? toDateTimeLocal(timestampDate(this.sale.saleEndTime))
						: '',
					quantity: String(type.quantity ?? ''),
					perAccountLimit: String(type.perAccountLimit),
					price: String(type.price?.value ?? ''),
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
			{ labelKey: 'shell.nav.concerts', href: paths.concerts },
			{ label: this.title, href: paths.concert(this.seriesId) },
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

	/** Window first, TicketType second; each only when it changed (D13). */
	private async saveChange(): Promise<void> {
		const sale = this.sale
		const type = sale?.ticketTypes.find(
			(t) => t.eventId?.value === this.eventId,
		)
		if (!sale || !type) return
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
			input.saleEndTime?.getTime() !==
				(sale.saleEndTime ? timestampDate(sale.saleEndTime).getTime() : 0)
		const typeChanged =
			input.price !== Number(type.price?.value ?? 0) ||
			input.quantity !== (type.quantity ?? 0) ||
			input.perAccountLimit !== type.perAccountLimit

		if (windowChanged) {
			try {
				const updated = await this.ticketSales.setWindow(
					this.saleId,
					input.saleStartTime,
					input.saleEndTime ?? input.saleStartTime,
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
		if (typeChanged) {
			try {
				const updated = await this.ticketTypes.update(
					{
						ticketTypeId: type.id?.value ?? '',
						price: input.price,
						quantity: input.quantity,
						perAccountLimit: input.perAccountLimit ?? 0,
					},
					this.abort.signal,
				)
				if (updated) Object.assign(type, updated)
			} catch (err) {
				this.logger.warn('Ticket type not saved', err)
				if (windowChanged) {
					// The window is saved; only the price, quantity and limit are not.
					this.saveProblem = 'lotteryEditor.partlySaved'
				}
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
