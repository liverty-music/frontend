import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import type { FieldError } from '../../i18n/field-error'
import {
	eventStart,
	isCancelled,
	isPublished,
	paths,
	perAccountLimitOf,
} from '../../model/concert-model'
import {
	REFERRAL_COLUMNS,
	referralRowsOf,
	type SaleView,
	saleViewsOf,
	VERIFICATION_OPTIONS,
	type VerificationRequirement,
} from '../../model/sale-model'
import { priceOf, type StockView, stockViewsOf } from '../../model/stock-model'
import { IClock } from '../../services/clock'
import { ISeatTypeClient, type SeatType } from '../../services/seat-type-client'
import {
	type EventTicketSales,
	ITicketSaleClient,
} from '../../services/ticket-sale-client'
import { ITicketStockClient } from '../../services/ticket-stock-client'
import { IConsoleContext } from '../../shell/console-context'
import { IPageProgress } from '../../shell/page-progress'
import type { ConfirmDialog } from '../../ui/confirm-dialog/confirm-dialog'
import type { FieldOption } from '../../ui/console-field/console-field'
import { ISnackbar } from '../../ui/console-snackbar/snackbar'
import type { DataRow } from '../../ui/data-list/data-list'
import { IEventPage } from '../event-page'

export type SalesPrerequisite =
	| 'notPublished'
	| 'noStartTime'
	| 'noStock'
	| 'businessDetails'

/** How often a countdown and a sale's state are recomputed. */
export const REFRESH_MS = 60_000

/** The input of 席種を追加 on the Sales tab: a seat type and its quantity. */
export interface StockFormModel {
	seatTypeId: string
	quantity: string
}

export interface StockFormErrors {
	seatTypeId?: FieldError
	quantity?: FieldError
}

/**
 * Checks the stock to add the way the server will: one of the concert's
 * seat types not yet stocked for the event, and a whole quantity of at
 * least 1.
 */
export function validateStockForm(
	model: StockFormModel,
	choices: readonly string[],
): StockFormErrors {
	const errors: StockFormErrors = {}
	if (!choices.includes(model.seatTypeId)) {
		errors.seatTypeId = { key: 'stock.error.seatType' }
	}
	const quantity = model.quantity.trim()
	if (!/^\d+$/.test(quantity) || Number(quantity) < 1) {
		errors.quantity = { key: 'stock.error.quantity' }
	}
	return errors
}

/**
 * The event's Sales tab: its seat types and quantities (席種と枚数), read
 * with TicketStockService.ListByEvent and shown whatever the event's
 * prerequisites; why no sale can start yet, or the event's sales in start
 * order with their state; and the actions to stock a seat type, start a
 * lottery or a first-come sale, edit a sale and change its verification
 * requirement. Below the sales, the event's purchases per referral code
 * (read-only).
 */
export class SalesTab {
	public readonly page = resolve(IEventPage)
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly ticketStocks = resolve(ITicketStockClient)
	private readonly seatTypeClient = resolve(ISeatTypeClient)
	private readonly snackbar = resolve(ISnackbar)
	private readonly clock = resolve(IClock)
	private readonly context = resolve(IConsoleContext)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('SalesTab')

	public state: 'loading' | 'ready' | 'error' = 'loading'
	public sales: SaleView[] = []
	/** The event's TicketStocks with their counts, in the order read. */
	public stocks: StockView[] = []
	/** The concert's seat types, from SeatTypeService.ListBySeries. */
	public seatTypes: SeatType[] = []
	/** The event's Paid Orders per referral code, the direct group last. */
	public referralRows: DataRow[] = []
	public readonly referralColumns = REFERRAL_COLUMNS

	public stockForm: StockFormModel = { seatTypeId: '', quantity: '' }
	public stockSubmitted = false
	/** Set when the server refused a stock the form thought valid. */
	public stockProblem: FieldError | null = null
	public addStockDialog!: ConfirmDialog
	public deleteStockDialog!: ConfirmDialog
	/** The stock the delete dialog asks about. */
	public stockToDelete: StockView | null = null

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
		if (this.stocks.length === 0) return 'noStock'
		if (!this.page.businessDetailsComplete) return 'businessDetails'
		return null
	}

	public get hasFirstCome(): boolean {
		return this.sales.some((s) => s.method === 'firstCome')
	}

	/** The event's per-account limit, across every sale and seat type. */
	public get perAccountLimit(): number {
		return this.page.event ? perAccountLimitOf(this.page.event) : 0
	}

	/** A cancelled date stocks nothing more (TicketStockService.Create refuses it). */
	public get canStock(): boolean {
		return !!this.page.event && !isCancelled(this.page.event)
	}

	/** The concert's seat types not yet stocked for the event. */
	public get unstockedSeatTypes(): SeatType[] {
		const stocked = new Set(this.stocks.map((s) => s.seatTypeId))
		return this.seatTypes.filter((t) => !stocked.has(t.id?.value ?? ''))
	}

	public get seatTypeOptions(): FieldOption[] {
		return [
			{ value: '', labelKey: 'stock.chooseSeatType' },
			...this.unstockedSeatTypes.map((t) => ({
				value: t.id?.value ?? '',
				labelKey: 'stock.seatTypeOption',
				params: { name: t.name?.value ?? '', price: priceOf(t) },
			})),
		]
	}

	/** The seat type chosen in the add form. */
	public get chosenSeatType(): SeatType | undefined {
		return this.seatTypes.find((t) => t.id?.value === this.stockForm.seatTypeId)
	}

	/** The add dialog's title values: the seat type and the quantity entered. */
	public get addStockParams(): Record<string, unknown> {
		return {
			name: this.chosenSeatType?.name?.value ?? '',
			quantity: Number(this.stockForm.quantity.trim()),
		}
	}

	public get stockErrors(): StockFormErrors {
		return validateStockForm(
			this.stockForm,
			this.unstockedSeatTypes.map((t) => t.id?.value ?? ''),
		)
	}

	/** The error of a stock field once 席種を追加 was pressed. */
	public stockError(
		error: FieldError | undefined,
		submitted = this.stockSubmitted,
	): FieldError | null {
		if (!submitted || !error) return null
		return error
	}

	public readonly verificationOptions: FieldOption[] = VERIFICATION_OPTIONS.map(
		(o) => ({ value: String(o.value), labelKey: o.labelKey }),
	)

	public get newLotteryHref(): string {
		return paths.newSale(
			this.context.scope,
			this.page.seriesId,
			this.page.eventId,
			'lottery',
		)
	}

	public get firstComeHref(): string {
		return paths.newSale(
			this.context.scope,
			this.page.seriesId,
			this.page.eventId,
			'first-come',
		)
	}

	public get editConcertHref(): string {
		return paths.editConcert(this.context.scope, this.page.seriesId)
	}

	/** The concert page, where the concert's seat types are added. */
	public get concertHref(): string {
		return paths.concert(this.context.scope, this.page.seriesId)
	}

	/** The sale's editor: the lottery before it opens, or the first-come sale. */
	public editHref(sale: SaleView): string {
		return paths.editSale(
			this.context.scope,
			this.page.seriesId,
			this.page.eventId,
			sale.id,
		)
	}

	/** Reads the stocks and sales; the shell's progress indicator shows meanwhile. */
	public load(): Promise<void> {
		return this.progress.track(this.read())
	}

	private async read(): Promise<void> {
		this.state = 'loading'
		try {
			const [sales, stocks, seatTypes] = await Promise.all([
				this.ticketSales.listByEvent(this.page.eventId, this.abort.signal),
				this.ticketStocks.listByEvent(this.page.eventId, this.abort.signal),
				this.seatTypeClient.listBySeries(this.page.seriesId, this.abort.signal),
			])
			this.data = sales
			this.stocks = stockViewsOf(stocks)
			this.seatTypes = seatTypes
			this.recompute()
			this.state = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Sales unavailable', err)
			this.state = 'error'
		}
	}

	/** Re-reads the stocks (and the sales, whose lottery remainders read them). */
	private async refreshStocks(): Promise<void> {
		try {
			const [stocks, sales] = await Promise.all([
				this.ticketStocks.listByEvent(this.page.eventId, this.abort.signal),
				this.ticketSales.listByEvent(this.page.eventId, this.abort.signal),
			])
			this.stocks = stockViewsOf(stocks)
			this.data = sales
			this.recompute()
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Stocks not re-read', err)
			this.snackbar.showError('stock.refreshFailed', {
				retry: () => void this.refreshStocks(),
			})
		}
	}

	public requestPublish(): void {
		void this.page.requestPublish()
	}

	/**
	 * 席種を追加: asks to confirm that the quantity never changes and that every
	 * sale of the event sells it, then creates the TicketStock.
	 */
	public async addStock(): Promise<void> {
		this.stockSubmitted = true
		this.stockProblem = null
		const errors = this.stockErrors
		if (errors.seatTypeId || errors.quantity) return
		if (!(await this.addStockDialog.ask())) return
		const name = this.chosenSeatType?.name?.value ?? ''
		try {
			await this.ticketStocks.create(
				{
					eventId: this.page.eventId,
					seatTypeId: this.stockForm.seatTypeId,
					quantity: Number(this.stockForm.quantity.trim()),
				},
				this.abort.signal,
			)
			this.stockForm = { seatTypeId: '', quantity: '' }
			this.stockSubmitted = false
			this.snackbar.show('stock.added', { name })
			await this.refreshStocks()
		} catch (err) {
			this.logger.warn('Stock not added', err)
			if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
				// Another member stocked the seat type meanwhile: the refreshed
				// list no longer offers it, and may leave nothing to add, so the
				// form is reset and the reason is told by the snackbar.
				this.stockForm = { seatTypeId: '', quantity: '' }
				this.stockSubmitted = false
				this.snackbar.showError('stock.error.alreadyStocked')
				await this.refreshStocks()
				return
			}
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				this.snackbar.showError('stock.addRefused')
				return
			}
			this.snackbar.showError('stock.addFailed', {
				retry: () => void this.addStock(),
			})
		}
	}

	/** 削除: deletes the stock after confirmation. */
	public async deleteStock(stock: StockView): Promise<void> {
		this.stockToDelete = stock
		if (!(await this.deleteStockDialog.ask())) return
		try {
			await this.ticketStocks.delete(stock.id, this.abort.signal)
			this.snackbar.show('stock.deleted', { name: stock.name })
		} catch (err) {
			this.logger.warn('Stock not deleted', err)
			if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
				// A fan has an Order for it (a lottery entry counts in neither
				// the sold nor the held tickets the list shows).
				this.snackbar.showError('stock.deleteRefused', {
					params: { name: stock.name },
				})
			} else {
				this.snackbar.showError('stock.deleteFailed', {
					retry: () => void this.deleteStock(stock),
				})
				return
			}
		}
		await this.refreshStocks()
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
			this.snackbar.show('sale.verificationSaved')
		} catch (err) {
			this.logger.warn('Verification requirement not saved', err)
			sale.verification = saved
			this.snackbar.showError('sale.verificationFailed', {
				retry: () => void this.changeVerification(sale, value),
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
		this.sales = saleViewsOf(
			this.page.eventId,
			this.data,
			this.clock.now(),
			this.stocks,
		)
		this.referralRows = referralRowsOf(this.data.referralCodeStats)
	}
}
