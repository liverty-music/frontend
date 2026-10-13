import { IRouter, IRouterEvents, type Params, route } from '@aurelia/router'
import { Visibility } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import {
	concertTitle,
	eventDay,
	eventStart,
	isCancelled,
	isDraft,
	paths,
	publishBadge,
	venueName,
} from '../model/concert-model'
import { ISeriesClient } from '../services/series-client'
import { type Crumb, IBreadcrumbs } from '../shell/breadcrumbs'
import { IConsoleContext } from '../shell/console-context'
import type { ConfirmDialog } from '../ui/confirm-dialog/confirm-dialog'
import { ISnackbar } from '../ui/console-snackbar/snackbar'
import type { ConsoleTab } from '../ui/console-tabs/console-tabs'
import { IEventPage } from './event-page'

/**
 * One event (one date of a concert): its date, venue and publish state with
 * 公開する, 中止する and 編集, and its Sales (`ticket-sales`) and Reception
 * (`scanners`) tabs, each a child route so a tab is its own address. The page
 * opens on 販売. The sale editors are child routes too
 * (`ticket-sales/new?method=…`, `ticket-sales/{sale}/edit`, design D1); while
 * one is open the header and tabs are hidden and the editor owns the
 * breadcrumb.
 */
@route({
	routes: [
		{ path: '', redirectTo: 'ticket-sales' },
		{
			path: 'ticket-sales',
			component: import('./sales-tab/sales-tab'),
			title: 'Sales',
		},
		{
			path: 'scanners',
			component: import('./reception-tab/reception-tab'),
			title: 'Reception',
		},
		// The sale editors replace the event's header and tabs; each sets its
		// own title and breadcrumb. One route opens either editor: the method
		// of a new sale is in the query, an existing sale's is read.
		{
			path: 'ticket-sales/new',
			component: import('../sale-editor/sale-editor-route'),
			title: 'New sale',
		},
		{
			path: 'ticket-sales/:saleId/edit',
			component: import('../sale-editor/sale-editor-route'),
			title: 'Sale',
		},
	],
})
export class EventRoute {
	public readonly page = resolve(IEventPage)
	private readonly series = resolve(ISeriesClient)
	private readonly breadcrumbs = resolve(IBreadcrumbs)
	private readonly snackbar = resolve(ISnackbar)
	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	private readonly context = resolve(IConsoleContext)
	private readonly logger = resolve(ILogger).scopeTo('EventRoute')

	public publishDialog!: ConfirmDialog
	public cancelDialog!: ConfirmDialog
	public activeTab = 'sales'
	/** True while a sale editor child route is open. */
	public editing = false
	public publishing = false
	public cancelling = false
	private subscription: IDisposable | null = null

	public async loading(params: Params): Promise<void> {
		await this.page.load(
			params.artistId ?? '',
			params.seriesId ?? '',
			params.eventId ?? '',
		)
	}

	public binding(): void {
		this.page.publishHandler = () => this.publish()
		this.subscription = this.routerEvents.subscribe(
			'au:router:navigation-end',
			() => this.syncTab(),
		)
		this.syncTab()
	}

	public unbinding(): void {
		this.page.publishHandler = null
		this.subscription?.dispose()
	}

	public get tabs(): ConsoleTab[] {
		return [
			{
				id: 'sales',
				labelKey: 'event.tab.sales',
				href: paths.sales(
					this.context.scope,
					this.page.seriesId,
					this.page.eventId,
				),
			},
			{
				id: 'reception',
				labelKey: 'event.tab.reception',
				href: paths.scanners(
					this.context.scope,
					this.page.seriesId,
					this.page.eventId,
				),
			},
		]
	}

	public get start(): Date | undefined {
		return this.page.event ? eventStart(this.page.event) : undefined
	}

	public get day(): Date | undefined {
		return this.page.event ? eventDay(this.page.event) : undefined
	}

	public get venue(): string {
		return this.page.event ? venueName(this.page.event) : ''
	}

	public get title(): string {
		return this.page.concert ? concertTitle(this.page.concert) : ''
	}

	public get badge() {
		return publishBadge(this.page.event?.publishState ?? 0)
	}

	public get cancelled(): boolean {
		return !!this.page.event && isCancelled(this.page.event)
	}

	public get draft(): boolean {
		return !!this.page.event && isDraft(this.page.event)
	}

	public get unlisted(): boolean {
		return this.page.concert?.series.visibility === Visibility.UNLISTED
	}

	public get editHref(): string {
		return paths.editConcert(this.context.scope, this.page.seriesId)
	}

	public get concertHref(): string {
		return paths.concert(this.context.scope, this.page.seriesId)
	}

	public get concertsHref(): string {
		return paths.concerts(this.context.scope)
	}

	public async publish(): Promise<void> {
		if (!this.draft || this.publishing) return
		if (!(await this.publishDialog.ask())) return
		this.publishing = true
		try {
			const concert = await this.series.publish(this.page.seriesId, [
				this.page.eventId,
			])
			if (concert) this.page.update(concert)
			else await this.page.reload()
			this.snackbar.show('event.published')
		} catch (err) {
			this.logger.warn('Publish failed', err)
			this.snackbar.showError('event.publishFailed', {
				retry: () => void this.publishConfirmed(),
			})
		} finally {
			this.publishing = false
		}
	}

	/** Retry of a confirmed publish: the operator already said yes. */
	private async publishConfirmed(): Promise<void> {
		try {
			const concert = await this.series.publish(this.page.seriesId, [
				this.page.eventId,
			])
			if (concert) this.page.update(concert)
			this.snackbar.show('event.published')
		} catch (err) {
			this.logger.warn('Publish failed', err)
			this.snackbar.showError('event.publishFailed')
		}
	}

	public async cancel(): Promise<void> {
		if (this.cancelled || this.cancelling) return
		if (!(await this.cancelDialog.ask())) return
		const wasDraft = this.draft
		this.cancelling = true
		try {
			await this.series.cancel(this.page.seriesId, [this.page.eventId])
			this.snackbar.show(wasDraft ? 'event.draftRemoved' : 'event.cancelled')
			if (wasDraft) {
				// A cancelled draft is removed: its page no longer exists.
				await this.router.load(this.concertHref)
				return
			}
			await this.page.reload()
		} catch (err) {
			this.logger.warn('Cancel failed', err)
			this.snackbar.showError('event.cancelFailed')
		} finally {
			this.cancelling = false
		}
	}

	/**
	 * Follows the address: the selected tab, whether a sale editor is open, and
	 * the event's breadcrumb, which an open editor replaces with its own.
	 */
	private syncTab(): void {
		const path = window.location.pathname
		this.editing = /\/ticket-sales\/(new|[^/]+\/edit)$/.test(path)
		this.activeTab = path.endsWith('/scanners') ? 'reception' : 'sales'
		if (!this.editing) this.setBreadcrumb()
	}

	private setBreadcrumb(): void {
		const trail: Crumb[] = [
			{ labelKey: 'shell.nav.concerts', href: this.concertsHref },
		]
		if (this.page.concert) {
			trail.push({ label: this.title, href: this.concertHref })
		}
		if (this.page.event) trail.push({ day: this.day })
		this.breadcrumbs.set(trail)
	}
}
