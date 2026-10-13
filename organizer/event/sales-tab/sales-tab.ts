import { I18N } from '@aurelia/i18n'
import { ILogger, resolve } from 'aurelia'
import { eventStart, isPublished, paths } from '../../model/concert-model'
import {
	type SaleView,
	saleViewsOf,
	VERIFICATION_OPTIONS,
	type VerificationRequirement,
} from '../../model/sale-model'
import { IClock } from '../../services/clock'
import {
	type EventTicketSales,
	ITicketSaleClient,
} from '../../services/ticket-sale-client'
import type { FieldOption } from '../../ui/console-field/console-field'
import { ISnackbar } from '../../ui/console-snackbar/snackbar'
import { IEventPage } from '../event-page'

export type SalesPrerequisite =
	| 'notPublished'
	| 'noStartTime'
	| 'businessDetails'

/** How often a countdown and a sale's state are recomputed. */
export const REFRESH_MS = 60_000

/**
 * The event's Sales tab: why no sale can start yet, or the event's sales in
 * start order with their state, and the actions to start a lottery or a
 * first-come sale, edit a sale and change its verification requirement.
 */
export class SalesTab {
	public readonly page = resolve(IEventPage)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly snackbar = resolve(ISnackbar)
	private readonly i18n = resolve(I18N)
	private readonly clock = resolve(IClock)
	private readonly logger = resolve(ILogger).scopeTo('SalesTab')

	public state: 'loading' | 'ready' | 'error' = 'loading'
	public sales: SaleView[] = []
	private data: EventTicketSales | null = null
	private timer: ReturnType<typeof setInterval> | null = null
	private abort = new AbortController()

	public async loading(): Promise<void> {
		await this.page.ready
	}

	public attached(): void {
		void this.load()
		this.timer = setInterval(() => this.recompute(), REFRESH_MS)
	}

	public detaching(): void {
		if (this.timer !== null) clearInterval(this.timer)
		this.timer = null
		this.abort.abort()
	}

	public get prerequisite(): SalesPrerequisite | null {
		const event = this.page.event
		if (!event || !isPublished(event)) return 'notPublished'
		if (!eventStart(event)) return 'noStartTime'
		if (!this.page.businessDetailsComplete) return 'businessDetails'
		return null
	}

	public get hasFirstCome(): boolean {
		return this.sales.some((s) => s.method === 'firstCome')
	}

	public get verificationOptions(): FieldOption[] {
		return VERIFICATION_OPTIONS.map((o) => ({
			value: String(o.value),
			label: this.i18n.tr(o.labelKey),
		}))
	}

	public get newLotteryHref(): string {
		return paths.newLottery(this.page.seriesId, this.page.eventId)
	}

	public get firstComeHref(): string {
		return paths.firstCome(this.page.seriesId, this.page.eventId)
	}

	public get editConcertHref(): string {
		return paths.editConcert(this.page.seriesId)
	}

	public editHref(sale: SaleView): string {
		return sale.method === 'firstCome'
			? this.firstComeHref
			: paths.lottery(this.page.seriesId, this.page.eventId, sale.id)
	}

	public async load(): Promise<void> {
		this.state = 'loading'
		try {
			this.data = await this.ticketSales.listByEvent(
				this.page.eventId,
				this.abort.signal,
			)
			this.recompute()
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Sales unavailable', err)
			this.state = 'error'
		}
	}

	public requestPublish(): void {
		void this.page.requestPublish()
	}

	/** Saves the chosen requirement; on failure the choice returns to the saved one. */
	public async changeVerification(
		sale: SaleView,
		value: string,
	): Promise<void> {
		const next = Number(value) as VerificationRequirement
		const saved = sale.verification
		if (next === saved) return
		sale.verification = next
		try {
			await this.ticketSales.setVerificationRequirement(sale.id, next)
			this.setSavedVerification(sale.id, next)
			this.snackbar.show(this.i18n.tr('sale.verificationSaved'))
		} catch (err) {
			this.logger.warn('Verification requirement not saved', err)
			sale.verification = saved
			this.snackbar.showError(this.i18n.tr('sale.verificationFailed'), {
				label: this.i18n.tr('common.retry'),
				callback: () => void this.changeVerification(sale, value),
			})
		}
	}

	private setSavedVerification(
		id: string,
		value: VerificationRequirement,
	): void {
		const sale = this.data?.ticketSales.find((s) => s.id?.value === id)
		if (sale) sale.verificationRequirement = value
	}

	private recompute(): void {
		if (!this.data) return
		this.sales = saleViewsOf(this.page.eventId, this.data, this.clock.now())
	}
}
