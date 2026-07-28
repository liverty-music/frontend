import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { ICoachMarkService } from './services/coach-mark-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IOnboardingService } from './services/onboarding-service'
import { IPwaInstallService } from './services/pwa-install-service'
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
			data: { auth: false, nav: false },
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
			data: { auth: false, nav: false },
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
	private readonly logger = resolve(ILogger).scopeTo('AppShell')

	// Eagerly construct PwaInstallService so its `beforeinstallprompt` listener
	// is registered before any routing begins. AppShell activates ahead of the
	// first navigation, so this captures the event Chrome fires during the
	// `/auth/callback` page load — otherwise the prompt is silently lost.
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: held only for its DI construction side-effect (listener registration)
	private readonly _pwaInstall = resolve(IPwaInstallService)

	private readonly subscriptions: IDisposable[] = []

	// Updated on every navigation-end via route data `nav: false`.
	// Defaults to true so authenticated routes show the nav bar immediately.
	public showNav = true

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
			this.routerEvents.subscribe('au:router:navigation-end', () => {
				const node = this.router.routeTree.root.children[0]
				this.showNav = node?.data?.nav !== false
				const name = node?.context?.component?.name ?? 'unknown'
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
