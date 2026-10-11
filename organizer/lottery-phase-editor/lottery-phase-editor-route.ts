import type { Params } from '@aurelia/router'
import { IRouter } from '@aurelia/router'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { formatJstDateTime } from '../../shared/lib/reception/jst-format'
import { IConcertAuthoringClient } from '../services/concert-authoring-client'
import { Code, toOrganizerErrorMessage } from '../services/connect-error-copy'
import { findOverlappingSale } from '../services/sale-window'
import {
	ITicketSaleClient,
	type TicketSale,
} from '../services/ticket-sale-client'
import {
	emptyFormModel,
	isFormValid,
	type LotteryPhaseFormErrors,
	type LotteryPhaseFormModel,
	MAX_PER_ACCOUNT_LIMIT,
	MAX_WINDOW_DAYS,
	MIN_WINDOW_DAYS,
	parseDateTimeLocal,
	toCreateInput,
	validateLotteryPhaseForm,
} from './lottery-phase-form'

/** Coarse lifecycle phase for the screen. */
type ScreenPhase = 'ready' | 'done'

/**
 * Whether the event can go on sale: `checking` while the event is read,
 * `no-start-time` when it has no start time (no form, no save), `ok`
 * otherwise. When the event cannot be read the form stays available and the
 * server's own check decides.
 */
export type EventCheck = 'checking' | 'ok' | 'no-start-time'

/**
 * The lottery editor. Creates a named Lottery TicketSale of the event's Series
 * with one TicketType for the event it was opened from (the `eventId` route
 * parameter): the window, the quantity, the per-account limit (default 4,
 * 1–10) and the price.
 *
 * Validation mirrors the backend boundary (see {@link validateLotteryPhaseForm})
 * and runs on every input so inline errors — the required name, the 1–14 day
 * window defaulting to 10 days, and a window overlapping another sale of the
 * event — appear before a round-trip. On submit it calls
 * {@link ITicketSaleClient.create}; INVALID_ARGUMENT, FAILED_PRECONDITION and
 * PERMISSION_DENIED are translated via {@link toOrganizerErrorMessage}. On
 * success the created sale is shown with a link into the event's lottery
 * status.
 *
 * ENTRY POINT: the target event id arrives as the `:eventId` route param. The
 * console does not yet surface a per-event "put on sale" affordance from the
 * concerts dashboard (the authoring list is series-scoped and exposes no event
 * ids), so the route is currently reachable only by deep link — see the TODO in
 * `organizer-shell` routing.
 */
export class LotteryPhaseEditorRoute {
	public phase: ScreenPhase = 'ready'

	/** The PUBLISHED event this phase attaches to (from the route). */
	public eventId = ''

	public model: LotteryPhaseFormModel = emptyFormModel()
	public errors: LotteryPhaseFormErrors = {}
	/** Set true after the first save attempt so errors are not shown pre-emptively. */
	public submitted = false
	public saving = false
	public saveError = ''

	public eventCheck: EventCheck = 'checking'
	/** The event's series: the sale's Series and the concert editor link. */
	public seriesId = ''
	/** The event's start time; the lottery must close before it. */
	public eventStart: Date | null = null
	/** The event's existing sales, checked for an overlapping window. */
	public existingSales: TicketSale[] = []

	/** The created sale, populated on a successful create. */
	public createdSale: TicketSale | undefined

	private abort: AbortController | null = null

	private readonly client = resolve(ITicketSaleClient)
	private readonly concerts = resolve(IConcertAuthoringClient)
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LotteryPhaseEditorRoute')

	// Expose the window bounds to the template for helper copy.
	public readonly minWindowDays = MIN_WINDOW_DAYS
	public readonly maxWindowDays = MAX_WINDOW_DAYS
	public readonly maxLimit = MAX_PER_ACCOUNT_LIMIT

	public canLoad(params: Params): boolean {
		this.eventId = params.eventId ?? ''
		return true
	}

	public attached(): void {
		this.revalidate()
		void this.checkEvent()
	}

	/**
	 * Reads the event from the operator's concerts, and its existing sales: an
	 * event without a start time cannot go on sale, so the screen says so,
	 * links to the concert editor and offers no save. The open time stays
	 * optional.
	 */
	public async checkEvent(): Promise<void> {
		this.eventCheck = 'checking'
		void this.loadExistingSales()
		try {
			const concerts = await this.concerts.list()
			const concert = concerts.find((c) =>
				c.events.some((e) => e.id?.value === this.eventId),
			)
			const event = concert?.events.find((e) => e.id?.value === this.eventId)
			this.seriesId = concert?.series?.id?.value ?? ''
			const start = event?.startTime?.value
			this.eventStart = start ? timestampDate(start) : null
			this.eventCheck = event && !start ? 'no-start-time' : 'ok'
		} catch (err) {
			this.logger.warn(
				'Reading the event failed; the server will check it',
				err,
			)
			this.eventCheck = 'ok'
		}
		this.revalidate()
	}

	/** The event's sales; on failure the server's own overlap check decides. */
	private async loadExistingSales(): Promise<void> {
		try {
			const { ticketSales } = await this.client.listByEvent(this.eventId)
			this.existingSales = ticketSales
			this.revalidate()
		} catch (err) {
			this.logger.warn('Reading the event sales failed', err)
		}
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public get createdSaleId(): string {
		return this.createdSale?.id?.value ?? ''
	}

	public revalidate(): void {
		const errors = validateLotteryPhaseForm(this.model, {
			eventStart: this.eventStart,
		})
		const open = parseDateTimeLocal(this.model.openTime)
		const close = parseDateTimeLocal(this.model.closeTime)
		if (!errors.window && open && close) {
			const other = findOverlappingSale(this.existingSales, open, close)
			if (other) errors.window = overlapMessage(other)
		}
		this.errors = errors
	}

	public get formValid(): boolean {
		return isFormValid(this.errors)
	}

	public async save(): Promise<void> {
		if (this.saving || this.eventCheck !== 'ok') return
		this.submitted = true
		this.revalidate()
		if (!this.formValid) return
		this.saving = true
		this.saveError = ''
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		try {
			const sale = await this.client.create(
				toCreateInput(this.seriesId, this.eventId, this.model),
				abort.signal,
			)
			if (abort.signal.aborted) return
			this.createdSale = sale
			this.phase = 'done'
		} catch (err) {
			if (abort.signal.aborted) return
			this.saveError = toOrganizerErrorMessage(
				err,
				'Failed to create the lottery.',
				{
					[Code.FailedPrecondition]:
						'This event cannot go on sale with this lottery: publish its concert, set its start time, make sure the window ends before the event starts and does not overlap another sale of the event, and check that your business details are complete.',
					[Code.PermissionDenied]:
						'You are not allowed to put this event on sale.',
				},
			)
			this.logger.error('Create lottery failed', {
				eventId: this.eventId,
				err,
			})
		} finally {
			this.saving = false
		}
	}

	/** Navigates to the lottery status of the event. */
	public async viewStatus(): Promise<void> {
		if (!this.createdSaleId) return
		await this.router.load(`../lottery/status/${this.eventId}`)
	}
}

/** Says which existing sale the entered window overlaps, in Japan time. */
export function overlapMessage(sale: TicketSale): string {
	const name = sale.name?.value ?? ''
	const start = sale.saleStartTime
		? formatJstDateTime(timestampDate(sale.saleStartTime))
		: ''
	const end = sale.saleEndTime
		? formatJstDateTime(timestampDate(sale.saleEndTime))
		: ''
	return `The window overlaps the sale 「${name}」 (${start} – ${end}, Japan time). Sales of one event cannot overlap.`
}
