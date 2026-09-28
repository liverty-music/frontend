import { type INavigationRoute, IRouteContext } from '@aurelia/router'
import { resolve } from 'aurelia'

/**
 * The bottom navigation bar. Its tabs are the shell routes marked `nav: true`,
 * rendered from the router's navigation model in route-table order; each tab's
 * icon and label come from the route's `data.icon` / `data.labelKey`, and the
 * highlight is the router's own `isActive` for that route (so a second path of a
 * tab route, e.g. `concerts/:id` on Home, highlights it too).
 */
export class BottomNavBar {
	// The bar sits beside the shell's <au-viewport>, so this is the root route
	// context, whose navigation model holds the top-level routes.
	private readonly routeContext = resolve(IRouteContext)

	/** Tab routes, available once the lazily-imported route configs resolve. */
	public tabs: readonly INavigationRoute[] = []

	public binding(): void {
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
}
