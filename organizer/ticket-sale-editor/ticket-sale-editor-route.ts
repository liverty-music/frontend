import type { Params } from '@aurelia/router'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { TicketSaleMethod } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
import { TicketTypeState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_type_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { formatJstDateTime } from '../../shared/lib/reception/jst-format'
import { IConcertAuthoringClient } from '../services/concert-authoring-client'
import {
	Code,
	ConnectError,
	toOrganizerErrorMessage,
} from '../services/connect-error-copy'
import { IOrganizerIdentityClient } from '../services/organizer-identity-client'
import { findOverlappingSale } from '../services/sale-window'
import {
	ITicketSaleClient,
	type TicketSale,
	type TicketType,
} from '../services/ticket-sale-client'
import { ITicketTypeClient } from '../services/ticket-type-client'
import {
	blankFormModel,
	formatYen,
	formModelOf,
	isFormValid,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_PRICE,
	MIN_PER_ACCOUNT_LIMIT,
	MIN_PRICE,
	parseJstDateTimeLocal,
	type TicketSaleFormErrors,
	type TicketSaleFormModel,
	toCreateInput,
	validateTicketSaleForm,
} from './ticket-sale-form'

type LoadPhase = 'loading' | 'ready' | 'not-found' | 'error'

/**
 * A reason the event cannot be put on sale. `cancelled` and `not-published`
 * come from the event's series, `no-start-time` from the event, and
 * `no-business-details` from the caller's Organizer.
 */
export type SaleBlock =
	| 'cancelled'
	| 'not-published'
	| 'no-start-time'
	| 'no-business-details'

const STATE_LABELS: Record<TicketTypeState, string> = {
	[TicketTypeState.UNSPECIFIED]: '—',
	[TicketTypeState.NOT_YET_ON_SALE]: '販売開始前',
	[TicketTypeState.ON_SALE]: '販売中',
	[TicketTypeState.ALL_HELD]: '残りはすべて確保中',
	[TicketTypeState.SOLD_OUT]: '完売',
	[TicketTypeState.ENDED]: '販売終了',
}

/** True when the Organizer has all five business details entered. */
export function hasCompleteBusinessDetails(
	organizer: Organizer | undefined,
): boolean {
	return Boolean(
		organizer?.legalName?.value.trim() &&
			organizer.representativeName?.value.trim() &&
			organizer.businessAddress?.value.trim() &&
			organizer.businessPhoneNumber?.value.trim() &&
			organizer.contactEmail?.value.trim(),
	)
}

/**
 * The event's first-come sale the editor works on: of the first-come sales
 * offering the event, the open one, otherwise the next to open, otherwise
 * the last that ended.
 */
export function firstComeSaleOf(
	sales: readonly TicketSale[],
	eventId: string,
	now: number = Date.now(),
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
 * The console screen where an operator puts one published event on sale first
 * come, first served, or changes that sale, and sees how many tickets have
 * sold. Reached from the event's row in the concert list (`ticket-sale/:eventId`).
 *
 * The event's sales are read with TicketSaleService.ListByEvent. For an event
 * without a first-come sale, saving creates a FirstCome sale of the event's
 * Series with one TicketType for the event (TicketSaleService.Create), named
 * 一般発売 by default, ending at the event's start time and allowing 4 tickets
 * per account by default. For an event with one, a changed window is saved
 * with TicketSaleService.SetWindow and a changed price, quantity or limit with
 * TicketTypeService.Update. A window overlapping another sale of the event is
 * refused next to the window.
 *
 * Times are entered and shown in Japan time whatever the browser's zone is.
 * Field errors mirror the server's rules and show next to the field without
 * saving. While any ticket is sold or held, the price is shown as fixed and
 * the quantity cannot go below sold + held.
 *
 * When the event is not published, has no start time, or the Organizer does
 * not have complete business details, the screen says which is missing and
 * offers no save. RPC errors are translated via {@link toOrganizerErrorMessage}.
 */
export class TicketSaleEditorRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''

	public eventId = ''
	public seriesId = ''
	public concertTitle = ''
	public eventDate = ''
	/** The event's start time; null when it has none. */
	public eventStart: Date | null = null
	public blocks: SaleBlock[] = []

	/** The event's first-come sale; undefined until one is created. */
	public sale: TicketSale | undefined
	/** Every sale of the event, checked for an overlapping window. */
	public sales: TicketSale[] = []

	public model: TicketSaleFormModel = blankFormModel(null)
	public errors: TicketSaleFormErrors = {}
	/** Errors show only after the first save attempt. */
	public submitted = false
	public saving = false
	public saveError = ''
	public saved = false

	public readonly minPrice = formatYen(MIN_PRICE)
	public readonly maxPrice = formatYen(MAX_PRICE)
	public readonly minLimit = MIN_PER_ACCOUNT_LIMIT
	public readonly maxLimit = MAX_PER_ACCOUNT_LIMIT

	private abort: AbortController | null = null

	private readonly concerts = resolve(IConcertAuthoringClient)
	private readonly organizers = resolve(IOrganizerIdentityClient)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketTypes = resolve(ITicketTypeClient)
	private readonly logger = resolve(ILogger).scopeTo('TicketSaleEditorRoute')

	public canLoad(params: Params): boolean {
		this.eventId = params.eventId ?? ''
		return true
	}

	public attached(): void {
		void this.load()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	/** The sale's TicketType for this event. */
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

	/** The price may change only while no ticket is sold or held. */
	public get priceLocked(): boolean {
		return this.soldCount + this.heldCount > 0
	}

	public get canSave(): boolean {
		return this.phase === 'ready' && this.blocks.length === 0
	}

	public get eventStartLabel(): string {
		return this.eventStart ? formatJstDateTime(this.eventStart) : ''
	}

	public get stateLabel(): string {
		return this.ticketType ? STATE_LABELS[this.ticketType.state] : ''
	}

	public get lockedPriceLabel(): string {
		return formatYen(this.ticketType?.price?.value ?? BigInt(0))
	}

	/**
	 * Reads the event (from the operator's concerts), the caller's Organizer
	 * and the event's sales, then fills the form from its first-come sale or
	 * the defaults.
	 */
	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const [concerts, organizer, sales] = await Promise.all([
				this.concerts.list(abort.signal),
				this.organizers.get(abort.signal),
				this.ticketSales.listByEvent(this.eventId, abort.signal),
			])
			if (abort.signal.aborted) return
			const concert = concerts.find((c) =>
				c.events.some((e) => e.id?.value === this.eventId),
			)
			const event = concert?.events.find((e) => e.id?.value === this.eventId)
			if (!concert || !event) {
				this.phase = 'not-found'
				return
			}
			this.seriesId = concert.series?.id?.value ?? ''
			this.concertTitle = concert.series?.title?.value ?? ''
			const d = event.localDate?.value
			this.eventDate = d
				? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
				: ''
			const start = event.startTime?.value
			this.eventStart = start ? timestampDate(start) : null

			const publishState =
				concert.series?.publishState ?? PublishState.UNSPECIFIED
			const blocks: SaleBlock[] = []
			if (publishState === PublishState.CANCELLED) blocks.push('cancelled')
			else if (publishState !== PublishState.PUBLISHED) {
				blocks.push('not-published')
			}
			if (!this.eventStart) blocks.push('no-start-time')
			if (!hasCompleteBusinessDetails(organizer)) {
				blocks.push('no-business-details')
			}
			this.blocks = blocks

			this.sales = sales.ticketSales
			this.applySale(firstComeSaleOf(this.sales, this.eventId))
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'販売設定を読み込めませんでした。',
				{
					[Code.PermissionDenied]: 'この公演の販売設定は表示できません。',
				},
			)
			this.phase = 'error'
			this.logger.error('Loading the ticket sale failed', err)
		}
	}

	public revalidate(): void {
		const errors = validateTicketSaleForm(this.model, {
			eventStart: this.eventStart,
			soldCount: this.soldCount,
			heldCount: this.heldCount,
		})
		const start = parseJstDateTimeLocal(this.model.saleStart)
		const end = parseJstDateTimeLocal(this.model.saleEnd)
		if (!errors.saleStart && !errors.saleEnd && start && end) {
			const other = findOverlappingSale(
				this.sales,
				start,
				end,
				this.sale?.id?.value,
			)
			if (other) errors.saleStart = overlapMessage(other)
		}
		this.errors = errors
	}

	public get formValid(): boolean {
		return isFormValid(this.errors)
	}

	public async save(): Promise<void> {
		if (this.saving || !this.canSave) return
		this.submitted = true
		this.saved = false
		this.revalidate()
		if (!this.formValid) return
		this.saving = true
		this.saveError = ''
		try {
			if (this.sale) await this.saveChanges(this.sale)
			else await this.create()
			this.submitted = false
			this.saved = true
		} catch (err) {
			this.saveError = toOrganizerErrorMessage(
				err,
				'販売設定を保存できませんでした。',
				{
					[Code.FailedPrecondition]:
						'保存できませんでした。公演の公開・開始時刻・事業者情報と、ほかの販売と期間が重なっていないかを確認してください。チケットが確保中または販売済みの間は価格を変更できず、販売数はその合計を下回れません。',
					[Code.InvalidArgument]: `入力内容が受け付けられませんでした。${err instanceof ConnectError ? err.rawMessage : ''}`,
					[Code.PermissionDenied]: 'この公演の販売設定は変更できません。',
				},
			)
			this.logger.error('Saving the ticket sale failed', {
				eventId: this.eventId,
				err,
			})
			// A checkout may have held tickets meanwhile: refresh the counts so the
			// price lock and quantity floor reflect them.
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				await this.refreshCounts()
			}
		} finally {
			this.saving = false
		}
	}

	private async create(): Promise<void> {
		const sale = await this.ticketSales.create(
			toCreateInput(this.seriesId, this.eventId, this.model),
		)
		if (sale) this.sales = [...this.sales, sale]
		this.applySale(sale)
	}

	/**
	 * Saves what changed: the window with SetWindow, the price, quantity or
	 * limit with TicketTypeService.Update.
	 */
	private async saveChanges(sale: TicketSale): Promise<void> {
		const stored = this.storedModel()
		const start = parseJstDateTimeLocal(this.model.saleStart) ?? new Date(0)
		const end = parseJstDateTimeLocal(this.model.saleEnd) ?? new Date(0)
		let updated = sale
		if (
			this.model.saleStart !== stored.saleStart ||
			this.model.saleEnd !== stored.saleEnd
		) {
			updated =
				(await this.ticketSales.setWindow(sale.id?.value ?? '', start, end)) ??
				updated
		}
		const type = this.ticketType
		if (
			type &&
			(this.model.price.trim() !== stored.price ||
				this.model.quantity.trim() !== stored.quantity ||
				this.model.perAccountLimit.trim() !== stored.perAccountLimit)
		) {
			const changed = await this.ticketTypes.update({
				ticketTypeId: type.id?.value ?? '',
				price: Number(this.model.price.trim()),
				quantity: Number(this.model.quantity.trim()),
				perAccountLimit: Number(this.model.perAccountLimit.trim()),
			})
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

	/** Re-reads the sale's counts without discarding the operator's input. */
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
			this.revalidate()
		} catch (err) {
			this.logger.warn('Refreshing the ticket sale failed', err)
		}
	}

	/** The form as the stored sale fills it. */
	private storedModel(): TicketSaleFormModel {
		const sale = this.sale
		const type = this.ticketType
		if (!sale || !type) return blankFormModel(this.eventStart)
		return formModelOf({
			name: sale.name?.value ?? '',
			saleStart: sale.saleStartTime ? timestampDate(sale.saleStartTime) : null,
			saleEnd: sale.saleEndTime ? timestampDate(sale.saleEndTime) : null,
			price: type.price?.value ?? BigInt(0),
			quantity: type.quantity ?? 0,
			perAccountLimit: type.perAccountLimit,
		})
	}

	/** Shows the sale and fills the form from it, or from the defaults. */
	private applySale(sale: TicketSale | undefined): void {
		this.sale = sale
		this.model = this.storedModel()
		this.revalidate()
	}
}

/** Says which existing sale the entered window overlaps, in Japan time. */
export function overlapMessage(sale: TicketSale): string {
	const start = sale.saleStartTime
		? formatJstDateTime(timestampDate(sale.saleStartTime))
		: ''
	const end = sale.saleEndTime
		? formatJstDateTime(timestampDate(sale.saleEndTime))
		: ''
	return `販売期間がほかの販売「${sale.name?.value ?? ''}」（${start}〜${end}）と重なっています。同じ公演の販売期間は重ねられません。`
}
