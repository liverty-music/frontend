import type { Params } from '@aurelia/router'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { TicketSaleState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/ticket_sale_pb.js'
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
import {
	ITicketSaleClient,
	type TicketSale,
} from '../services/ticket-sale-client'
import {
	blankFormModel,
	formatYen,
	formModelOf,
	isFormValid,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_PRICE,
	MIN_PER_ACCOUNT_LIMIT,
	MIN_PRICE,
	type TicketSaleFormErrors,
	type TicketSaleFormModel,
	toConfigureInput,
	validateTicketSaleForm,
} from './ticket-sale-form'

type LoadPhase = 'loading' | 'ready' | 'not-found' | 'error'

/**
 * A reason the event cannot be put on sale. `cancelled` and `not-published`
 * come from the event's series, `no-start-time` from the event, and
 * `no-seller-details` from the caller's Organizer.
 */
export type SaleBlock =
	| 'cancelled'
	| 'not-published'
	| 'no-start-time'
	| 'no-seller-details'

const STATE_LABELS: Record<TicketSaleState, string> = {
	[TicketSaleState.UNSPECIFIED]: '—',
	[TicketSaleState.NOT_YET_ON_SALE]: '販売開始前',
	[TicketSaleState.ON_SALE]: '販売中',
	[TicketSaleState.ALL_HELD]: '残りはすべて確保中',
	[TicketSaleState.SOLD_OUT]: '完売',
	[TicketSaleState.ENDED]: '販売終了',
}

/** True when the Organizer has all five seller details entered. */
export function hasCompleteSellerDetails(
	organizer: Organizer | undefined,
): boolean {
	const s = organizer?.sellerDetails
	return Boolean(
		s?.legalName.trim() &&
			s.representativeName.trim() &&
			s.address.trim() &&
			s.phoneNumber.trim() &&
			s.contactEmail.trim(),
	)
}

/**
 * The console screen where an operator puts one published event on sale first
 * come, first served, or changes that sale, and sees how many tickets have
 * sold. Reached from the event's row in the concert list (`ticket-sale/:eventId`).
 *
 * Times are entered and shown in Japan time whatever the browser's zone is.
 * A new sale ends at the event's start time and allows 4 tickets per account
 * by default. Field errors mirror the server's rules and show next to the
 * field without saving. While any ticket is sold or held, the price is shown
 * as fixed and the quantity cannot go below sold + held.
 *
 * When the event is not published, has no start time, or the Organizer has no
 * complete seller details, the screen says which is missing and offers no
 * save. Configure errors are translated via {@link toOrganizerErrorMessage}.
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

	/** The event's sale; undefined until one is configured. */
	public sale: TicketSale | undefined

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

	public get soldCount(): number {
		return this.sale?.soldCount ?? 0
	}

	public get heldCount(): number {
		return this.sale?.heldCount ?? 0
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
		return this.sale ? STATE_LABELS[this.sale.state] : ''
	}

	public get lockedPriceLabel(): string {
		return this.sale ? formatYen(this.sale.price) : ''
	}

	/**
	 * Reads the event (from the operator's concerts), the caller's Organizer
	 * and the event's sale, then fills the form from the sale or the defaults.
	 */
	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const [concerts, organizer, sale] = await Promise.all([
				this.concerts.list(abort.signal),
				this.organizers.get(abort.signal),
				this.ticketSales.get(this.eventId, abort.signal),
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
			if (!hasCompleteSellerDetails(organizer)) {
				blocks.push('no-seller-details')
			}
			this.blocks = blocks

			this.applySale(sale)
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
		this.errors = validateTicketSaleForm(this.model, {
			eventStart: this.eventStart,
			soldCount: this.soldCount,
			heldCount: this.heldCount,
		})
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
			const sale = await this.ticketSales.configure(
				toConfigureInput(this.eventId, this.model),
			)
			this.applySale(sale)
			this.submitted = false
			this.saved = true
		} catch (err) {
			this.saveError = toOrganizerErrorMessage(
				err,
				'販売設定を保存できませんでした。',
				{
					[Code.FailedPrecondition]:
						'保存できませんでした。公演の公開・開始時刻・販売者情報を確認してください。チケットが確保中または販売済みの間は価格を変更できず、販売数はその合計を下回れません。',
					[Code.InvalidArgument]: `入力内容が受け付けられませんでした。${err instanceof ConnectError ? err.rawMessage : ''}`,
					[Code.PermissionDenied]: 'この公演の販売設定は変更できません。',
				},
			)
			this.logger.error('Configure ticket sale failed', {
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

	/** Re-reads the sale's counts without discarding the operator's input. */
	private async refreshCounts(): Promise<void> {
		try {
			const sale = await this.ticketSales.get(this.eventId)
			if (!sale) return
			this.sale = sale
			if (this.priceLocked) this.model.price = sale.price.toString()
			this.revalidate()
		} catch (err) {
			this.logger.warn('Refreshing the ticket sale failed', err)
		}
	}

	/** Shows the sale and fills the form from it, or from the defaults. */
	private applySale(sale: TicketSale | undefined): void {
		this.sale = sale
		this.model = sale
			? formModelOf({
					saleStart: sale.saleStartTime
						? timestampDate(sale.saleStartTime)
						: null,
					saleEnd: sale.saleEndTime ? timestampDate(sale.saleEndTime) : null,
					price: sale.price,
					quantity: sale.quantity ?? 0,
					perAccountLimit: sale.perAccountLimit,
				})
			: blankFormModel(this.eventStart)
		this.revalidate()
	}
}
