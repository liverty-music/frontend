import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IOnboardingService } from './services/onboarding-service'

@route({
	title: 'Liverty Music',
	routes: [
		{
			path: ['', 'welcome'],
			component: import('./welcome-page'),
			title: 'Welcome',
			data: { auth: false },
		},
		{
			path: 'about',
			component: import('./about-page'),
			title: 'About',
			data: { auth: false },
		},
		{
			path: 'auth/callback',
			component: import('./routes/auth-callback'),
			title: 'Signing In',
			data: { auth: false },
		},
		{
			path: 'onboarding/loading',
			component: import('./routes/onboarding-loading/loading-sequence'),
			title: 'Loading',
			data: { auth: false, tutorialStep: 2 },
		},
		{
			path: 'dashboard',
			component: import('./routes/dashboard'),
			title: 'Dashboard',
			data: { tutorialStep: 3 },
		},
		{
			path: 'concerts/:id',
			component: import('./routes/dashboard'),
			title: 'Concert',
		},
		{
			path: 'discover',
			component: import('./routes/discover/discover-page'),
			title: 'Discover',
			data: { auth: false },
		},
		{
			path: 'my-artists',
			component: import('./routes/my-artists/my-artists-page'),
			title: 'My Artists',
			data: { tutorialStep: 5 },
		},
		{
			path: 'tickets',
			component: import('./routes/tickets/tickets-page'),
			title: 'Tickets',
		},
		{
			path: 'settings',
			component: import('./routes/settings/settings-page'),
			title: 'Settings',
		},
	],
	fallback: import('./routes/not-found/not-found-page'),
})
export class MyApp {
	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('MyApp')

	private readonly subscriptions: IDisposable[] = []

	private readonly fullscreenRoutes = [
		'',
		'welcome',
		'onboarding/loading',
		'auth/callback',
	]

	public get currentPath(): string {
		const tree = (
			this.router as IRouter & {
				routeTree?: {
					root?: { children?: Array<{ computeAbsolutePath?: () => string }> }
				}
			}
		).routeTree
		return tree?.root?.children?.[0]?.computeAbsolutePath?.() ?? ''
	}

	public get showNav(): boolean {
		const path = this.currentPath
		if (this.fullscreenRoutes.some((r) => path === r)) return false
		if (path === 'discover' && this.onboarding.isOnboarding) return false
		return true
	}

	public binding(): void {
		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-error', (event) => {
				this.logger.error('Navigation error', { event })
				this.errorBoundary.captureError(
					(event as unknown as { error?: unknown }).error ??
						'Navigation failed',
					'router:navigation-error',
				)
			}),
		)

		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-end', (event) => {
				const instruction = (
					event as unknown as {
						instructions?: Array<{ component?: { name?: string } }>
					}
				).instructions
				const name = instruction?.[0]?.component?.name ?? 'unknown'
				this.errorBoundary.addBreadcrumb('navigation', name)
			}),
		)
	}

	public unbinding(): void {
		for (const sub of this.subscriptions) {
			sub.dispose()
		}
		this.subscriptions.length = 0
	}
}
