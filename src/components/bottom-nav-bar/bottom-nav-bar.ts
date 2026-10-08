import {
	type INavigationRoute,
	IRouteContext,
	IRouter,
	IRouterEvents,
} from '@aurelia/router'
import { type IDisposable, resolve } from 'aurelia'
import type { ShellRouteData } from '../../app-shell'

/**
 * The bottom navigation bar. Its tabs are the shell routes marked `nav: true`,
 * rendered from the router's navigation model in route-table order; each tab's
 * icon and label come from the route's `data.icon` / `data.labelKey`, and the
 * highlight is the router's own `isActive` for that route (so a second path of a
 * tab route, e.g. `concerts/:id` on Home, highlights it too), or the displayed
 * route's `data.section` naming the tab's route id (the Event page on Home).
 */
export class BottomNavBar {
	// The bar sits beside the shell's <au-viewport>, so this is the root route
	// context, whose navigation model holds the top-level routes.
	private readonly routeContext = resolve(IRouteContext)

	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	private subscription: IDisposable | null = null

	/**
	 * Route id of the tab section the displayed route belongs to, or empty.
	 * Updated only when a navigation completes, so a navigation that is
	 * cancelled or fails never touches the highlight.
	 */
	public section = ''

	/** Tab routes, available once the lazily-imported route configs resolve. */
	public tabs: readonly INavigationRoute[] = []

	public binding(): void {
		this.subscription = this.routerEvents.subscribe(
			'au:router:navigation-end',
			() => this.updateSection(),
		)
		this.updateSection()
		const model = this.routeContext.routeConfigContext.navigationModel
		if (model === null) return
		// The model reserves a placeholder slot per lazily-imported route until it
		// resolves; read the routes only once all are in. Routing itself waits on
		// the same resolution before the first navigation, so this does not delay
		// the tabs past the first route.
		void Promise.resolve(model.resolve()).then(() => {
			this.tabs = model.routes
		})
	}

	public unbinding(): void {
		this.subscription?.dispose()
		this.subscription = null
	}

	private updateSection(): void {
		const data = this.router.routeTree?.root.children[0]?.data as
			| ShellRouteData
			| undefined
		this.section = data?.section ?? ''
	}
}
