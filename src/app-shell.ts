import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IOnboardingService } from './services/onboarding-service'
@route({
	title: 'Liverty Music',
	routes: [
		{
			path: 'welcome',
			component: import('./routes/welcome/welcome-route'),
			title: 'Welcome',
			data: { auth: false },
		},
		{
			path: 'about',
			component: import('./routes/about/about-route'),
			title: 'About',
			data: { auth: false },
		},
		{
			path: 'auth/callback',
			component: import('./routes/auth-callback/auth-callback-route'),
			title: 'Signing In',
			data: { auth: false },
		},
		{
			path: 'dashboard',
			component: import('./routes/dashboard/dashboard-route'),
			title: 'Dashboard',
			data: { onboardingStep: 'dashboard' },
		},
		{
			path: 'concerts/:id',
			component: import('./routes/dashboard/dashboard-route'),
			title: 'Concert',
		},
		{
			path: 'discovery',
			component: import('./routes/discovery/discovery-route'),
			title: 'Discovery',
			data: { auth: false, onboardingStep: 'discovery' },
		},
		{
			path: 'my-artists',
			component: import('./routes/my-artists/my-artists-route'),
			title: 'My Artists',
			data: { onboardingStep: 'my-artists' },
		},
		{
			path: 'tickets',
			component: import('./routes/tickets/tickets-route'),
			title: 'Tickets',
		},
		{
			path: 'settings',
			component: import('./routes/settings/settings-route'),
			title: 'Settings',
		},
		{
			path: 'import/ticket-email',
			component: import(
				'./routes/import-ticket-email/import-ticket-email-route'
			),
			title: 'Import Ticket Email',
			data: { auth: false },
		},
	],
	fallback: import('./routes/not-found/not-found-route'),
})
export class AppShell {
	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	public readonly auth = resolve(IAuthService)
	public readonly onboarding = resolve(IOnboardingService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly logger = resolve(ILogger).scopeTo('AppShell')

	private readonly subscriptions: IDisposable[] = []

	private readonly fullscreenRoutes = ['', 'welcome', 'auth/callback']

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
		return !this.fullscreenRoutes.some((r) => path === r)
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
