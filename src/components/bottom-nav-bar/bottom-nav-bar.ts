import {
	type INavigationRoute,
	IRouteContext,
	IRouter,
	IRouterEvents,
} from '@aurelia/router'
import { type IDisposable, ILogger, resolve, runTasks } from 'aurelia'
import type { ShellRouteData } from '../../app-shell'
import { IFabMenuService } from '../../services/fab-menu-service'

/**
 * The bottom navigation bar. Its tabs are the shell routes marked `nav: true`,
 * rendered from the router's navigation model in route-table order; each tab's
 * icon and label come from the route's `data.icon` / `data.labelKey`, and the
 * highlight is the router's own `isActive` for that route (so a second path of a
 * tab route, e.g. `concerts/:id` on Home, highlights it too), or the displayed
 * route's `data.section` naming the tab's route id (the Event page on Home).
 *
 * The bar keeps a centre slot for the FAB between the second and third tabs on
 * every route, so the tabs never move; it cuts a notch around the FAB while the
 * FAB is shown (the shell shows it when the route contributes actions).
 */
export class BottomNavBar {
	// The bar sits beside the shell's <au-viewport>, so this is the root route
	// context, whose navigation model holds the top-level routes.
	private readonly routeContext = resolve(IRouteContext)

	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	public readonly fabMenu = resolve(IFabMenuService)
	private readonly logger = resolve(ILogger).scopeTo('BottomNavBar')
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

	/**
	 * A tab was tapped. The route change runs inside a View Transition, so the
	 * route area cross-fades while the bar and the page header, which carry
	 * their own transition names, stay put (global.css). Bound in the capture
	 * phase, so it runs before the router's own `href` click handler on the
	 * same link, which it then stops; the link keeps the router's URL for a
	 * modified or non-primary click, which is left to the router and the
	 * browser (a new tab or window).
	 *
	 * The update callback settles once the router has swapped the route and
	 * Aurelia's queue is flushed; it never waits for a frame, which the
	 * browser does not produce while it captures the old view. It catches a
	 * failed route load, so only `ready` can reject: the browser rejects it
	 * when it skips the transition, and the route still changes without the
	 * cross-fade.
	 */
	public switchTab(event: MouseEvent, tab: INavigationRoute): boolean {
		if (
			event.button !== 0 ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		) {
			return true
		}
		event.preventDefault()
		event.stopPropagation()
		const path = tab.path[0]
		if (tab.isActive) {
			void this.router.load(path)
			return false
		}
		const transition = document.startViewTransition(async () => {
			try {
				await this.router.load(path)
			} catch (error) {
				this.logger.error('Tab switch failed', { path, error })
			}
			runTasks()
		})
		void transition.ready.catch(() => {})
		return false
	}

	private updateSection(): void {
		const data = this.router.routeTree?.root.children[0]?.data as
			| ShellRouteData
			| undefined
		this.section = data?.section ?? ''
	}
}
