import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { Events, IAnalyticsService } from './lib/analytics/analytics-service'
import { IAuthService } from './services/auth-service'
import { ICoachMarkService } from './services/coach-mark-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IOnboardingService } from './services/onboarding-service'
@route({
	title: 'Liverty Music',
	routes: [
		{
			path: '',
			redirectTo: 'welcome',
		},
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
			data: { auth: false },
		},
		{
			path: 'my-artists',
			component: import('./routes/my-artists/my-artists-route'),
			title: 'My Artists',
		},
		{
			path: 'consent',
			component: import('./routes/consent/consent-route'),
			title: 'Privacy & Analytics',
			// Public, directly-linkable privacy/analytics screen. No longer part
			// of the onboarding step machine (removed); consent application logic
			// is unchanged and lives in ConsentService.
			data: { auth: false },
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
		// Legal documents. Public (`auth: false`) so guests can open them
		// without an account, and so each has a stable, directly-linkable URL
		// (the product ships as a PWA only — there is no app-store listing).
		// Linked from Settings via the root router (SettingsRoute.openLegal),
		// not a `load`/`href` attribute: the attribute would resolve relative to
		// the Settings routing context (`/settings/legal/terms` → AUR3174).
		{
			path: 'legal/terms',
			component: import('./routes/legal/terms-route'),
			title: 'Terms of Service',
			data: { auth: false },
		},
		{
			path: 'legal/privacy',
			component: import('./routes/legal/privacy-route'),
			title: 'Privacy Policy',
			data: { auth: false },
		},
		{
			path: 'legal/licenses',
			component: import('./routes/legal/licenses-route'),
			title: 'OSS Licenses',
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
	public readonly coachMark = resolve(ICoachMarkService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly analytics = resolve(IAnalyticsService)
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

				// Analytics page-view emission. PII discipline (see
				// services/analytics-events.ts lines 51–72):
				//   - path: window.location.pathname ONLY. Never include
				//     `.search` (the auth/callback route carries OIDC
				//     `code` / `state` tokens there) or `.hash`. The
				//     router updates window.location synchronously
				//     before publishing navigation-end, so reading
				//     `pathname` here is the live value for the just-
				//     completed navigation.
				//   - title: read from document.title which the router
				//     has already set from the static `title:` on each
				//     route definition. This is the static label, not
				//     anything derived from a query string or user input,
				//     so it is safe to forward to PostHog.
				const path =
					typeof window !== 'undefined' ? window.location.pathname : ''
				const title = typeof document !== 'undefined' ? document.title : ''
				this.analytics.capture(Events.PageViewed, { path, title })
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
