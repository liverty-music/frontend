import { IRouteContext, type Params, type RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { paths } from '../model/concert-model'
import {
	ITicketSaleClient,
	TicketSaleMethod,
} from '../services/ticket-sale-client'
import { IConsoleContext } from '../shell/console-context'

/** The editor a sale opens in. */
export type SaleEditor = 'lottery' | 'firstCome'

/** The editor of `ticket-sales/new?method=…`; null for another method. */
export function editorOfMethod(method: string | null): SaleEditor | null {
	if (method === 'lottery') return 'lottery'
	if (method === 'first-come') return 'firstCome'
	return null
}

/** What an editor shown here must answer before the operator leaves. */
interface GuardedEditor {
	canUnload(): Promise<boolean>
}

/**
 * The sale editors' one address per action (design D1):
 * `ticket-sales/new?method=lottery|first-come` opens the editor of that
 * method, and `ticket-sales/{sale}/edit` the editor of the sale's method — the
 * lottery editor before it opens, the first-come editor at any time. A route
 * maps to one component, so this one picks the editor: from the query for a
 * new sale, from the event's sales for an existing one. The editor asks for
 * confirmation before unsaved changes are left, through this route.
 */
export class SaleEditorRoute {
	private readonly ticketSales = resolve(ITicketSaleClient)
	private readonly routeContext = resolve(IRouteContext)
	private readonly consoleContext = resolve(IConsoleContext)
	private readonly logger = resolve(ILogger).scopeTo('SaleEditorRoute')

	public state: 'loading' | 'ready' | 'notFound' | 'error' = 'loading'
	public editor: SaleEditor | null = null
	public view: GuardedEditor | undefined
	private saleId = ''
	private method: string | null = null
	private abort = new AbortController()

	public loading(params: Params, next: RouteNode): void {
		this.saleId = params.saleId ?? ''
		this.method = next.queryParams.get('method')
	}

	public attached(): void {
		void this.pick()
	}

	public detaching(): void {
		this.abort.abort()
	}

	public canUnload(): Promise<boolean> {
		return this.view?.canUnload() ?? Promise.resolve(true)
	}

	public get salesHref(): string {
		const { seriesId, eventId } = this.ids()
		return paths.sales(this.consoleContext.scope, seriesId, eventId)
	}

	public async pick(): Promise<void> {
		if (!this.saleId) {
			this.editor = editorOfMethod(this.method)
			this.state = this.editor ? 'ready' : 'notFound'
			return
		}
		this.state = 'loading'
		try {
			const { eventId } = this.ids()
			const { ticketSales } = await this.ticketSales.listByEvent(
				eventId,
				this.abort.signal,
			)
			const sale = ticketSales.find((s) => s.id?.value === this.saleId)
			this.editor =
				sale?.method === TicketSaleMethod.LOTTERY
					? 'lottery'
					: sale?.method === TicketSaleMethod.FIRST_COME
						? 'firstCome'
						: null
			this.state = this.editor ? 'ready' : 'notFound'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Sale unavailable', err)
			this.state = 'error'
		}
	}

	private ids(): { seriesId: string; eventId: string } {
		const params = this.routeContext.getRouteParameters<
			{ seriesId?: string; eventId?: string },
			'parent-first'
		>({ mergeStrategy: 'parent-first' })
		return { seriesId: params.seriesId ?? '', eventId: params.eventId ?? '' }
	}
}
