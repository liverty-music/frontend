import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { Events, IAnalyticsService } from './lib/analytics/analytics-service'
import { IAuthService } from './services/auth-service'
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
			path: 'consent',
			component: import('./routes/consent/consent-route'),
			title: 'Privacy & Analytics',
			// Final onboarding step. `auth: false` is intentional: guest
			// users in the my-artists step also reach the consent screen
			// (the my-artists route's hype-change handler advances to
			// CONSENT for both authenticated and guest paths), and the
			// PostHog SDK has no real user_id to identify either way
			// until signup. A guest who grants consent here carries the
			// choice forward when they later sign up. AuthHook's
			// progression gate (consent ordinally ≥ my-artists) still
			// protects against direct deep-links.
			data: { auth: false, onboardingStep: 'consent' },
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
			// Reachable from the discovery step onward so guests can sign in /
			// switch language without completing onboarding (see AuthHook).
			data: { earlyUnlock: true },
		},
		{
			path: 'import/ticket-email',
			component: import(
				'./routes/import-ticket-email/import-ticket-email-route'
			),
			title: 'Import Ticket Email',
			data: { auth: false },
		},
		// Legal documents. Public (`auth: false`) so guests and App Store /
		// Play Console reviewers can open them directly without an account —
		// the `/legal/privacy` URL is the store-registered Privacy Policy URL.
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
