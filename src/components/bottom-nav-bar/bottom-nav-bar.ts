import { IRouter, IRouterEvents } from '@aurelia/router'
import { type IDisposable, observable, resolve } from 'aurelia'

interface NavTab {
	path: string
	labelKey: string
	icon: string
}

const tabs: NavTab[] = [
	{ path: 'dashboard', labelKey: 'nav.home', icon: 'home' },
	{ path: 'discovery', labelKey: 'nav.discovery', icon: 'discovery' },
	{ path: 'my-artists', labelKey: 'nav.myArtists', icon: 'my-artists' },
	{ path: 'settings', labelKey: 'nav.settings', icon: 'settings' },
]

export class BottomNavBar {
	public readonly tabs = tabs

	/**
	 * The currently-active tab's `path`. `@observable` so the template's
	 * `data-active` binding re-evaluates on every navigation.
	 *
	 * The previous `isActive(path)` method read `router.routeTree` directly —
	 * router internals Aurelia's binding system cannot observe — so the active
	 * state was computed once at bind time and never updated after navigating
	 * (every tab stayed `data-active="false"`, so the selected-tab treatment and
	 * its spring-morph never showed). We now recompute it on the router's
	 * `navigation-end` event, mirroring `app-shell`'s nav tracking.
	 */
	@observable public activeTab = ''

	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	private navSub: IDisposable | null = null

	public binding(): void {
		// Seed the initial active tab (navigation-end has already fired for the
		// first route by the time this nested component binds).
		this.updateActiveTab()
	}

	public attached(): void {
		this.navSub = this.routerEvents.subscribe('au:router:navigation-end', () =>
			this.updateActiveTab(),
		)
	}

	public detaching(): void {
		this.navSub?.dispose()
		this.navSub = null
	}

	private updateActiveTab(): void {
		// Null-safe: the route tree may not be populated yet when this first runs
		// (e.g. binding() before the initial navigation, or a stub router in tests).
		const node = this.router.routeTree?.root?.children?.[0]
		const current = node?.computeAbsolutePath?.() ?? ''
		this.activeTab =
			tabs.find((tab) => this.matches(tab.path, current))?.path ?? ''
	}

	private matches(path: string, current: string): boolean {
		// Match exact path or sub-paths (e.g. concerts/:id still highlights Home).
		if (path === 'dashboard') {
			return current === 'dashboard' || current.startsWith('concerts/')
		}
		return current === path || current.startsWith(`${path}/`)
	}
}
