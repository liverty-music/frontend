import { IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { ICoachMarkService } from './services/coach-mark-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFabMenuService } from './services/fab-menu-service'
import { IOnboardingService } from './services/onboarding-service'
import {
	IPageHeaderState,
	type PageIdentity,
} from './services/page-header-state'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IPwaInstallService } from './services/pwa-install-service'

// Route table hoisted to a module-level const so both the `@route` decorator and
// the optimistic navigation-start resolver read the same definitions. Per-route
// page identity is colocated here as `data.titleKey` (the i18n key the shell
// header renders) and, for the dashboard, `data.morphTitle` (opt-in title
// View-Transition morph); routes without a `titleKey` render no header.
const routes = [
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
		// morphTitle: the dashboard swaps its title in place (My Timetable ↔ All
		// Nearby), so the shell header keeps a stable view-transition-name here.
		data: { titleKey: 'nav.home', morphTitle: true },
	},
	{
		path: 'concerts/:id',
		component: import('./routes/dashboard/dashboard-route'),
		title: 'Concert',
		// Reuses the dashboard component, so it shares the dashboard's identity.
		data: { titleKey: 'nav.home', morphTitle: true },
	},
	{
		path: 'discovery',
		component: import('./routes/discovery/discovery-route'),
		title: 'Discovery',
		data: { auth: false, titleKey: 'nav.discovery' },
	},
	{
		path: 'my-artists',
		component: import('./routes/my-artists/my-artists-route'),
		title: 'My Artists',
		data: { titleKey: 'nav.myArtists' },
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
		path: 'settings',
		component: import('./routes/settings/settings-route'),
		title: 'Settings',
		data: { titleKey: 'nav.settings' },
	},
	// PocketSign Stamp callback (identity-ekyc-jpki, Stamp redirect flow).
	// The PocketSign app returns here after the fan reads their card. Auth is
	// required: the fan must be authenticated when they return from the app.
	// No `data: { auth: false }` — the AuthHook guards this route.
	{
		path: 'verify/callback',
		component: import('./routes/verify-callback/verify-callback-route'),
		title: 'Identity Verification',
	},
	// Lottery APPLY flow (roadmap ④). Authenticated by default (Apply
	// resolves the fan from the token). `maxTickets` / `ticketPrice` ride the
	// path because the fan surface of LotteryService has no phase-read RPC
	// yet; the server re-validates both. TODO(lottery): drop these params and
	// load the phase once a fan-facing phase-read RPC exists, and decide the
	// production entry point (deep link from a concert/phase card) — this
	// route is intentionally reachable only via the explicit lottery path for
	// now, not wired into the bottom nav.
	{
		// Trailing `verificationRequired` ("true"/"false") is optional so
		// existing links resolve unchanged; when "true" the flow gates
		// UNVERIFIED fans on a verify-first prompt (identity-ekyc-jpki 5.2).
		path: 'lottery/:phaseId/apply/:maxTickets/:ticketPrice/:verificationRequired?',
		component: import('./routes/lottery-apply/lottery-apply-route'),
		title: 'Lottery Application',
	},
	// Lottery MY-APPLICATION + RESULT view (roadmap ④, tasks 4.2/4.3).
	// Authenticated by default (the application is resolved from the token +
	// phase). Renders the caller's application, its state (抽選待ち / 当選 /
	// 落選 / 取下げ済み) and the pre-draw notice, and hosts the withdraw action
	// while APPLIED. Like the apply route it is reachable only via the explicit
	// lottery path for now — NOT wired into the bottom nav; the production entry
	// point (deep link from a concert/phase card or a "my applications" list)
	// is decided in a later increment.
	{
		path: 'lottery/:phaseId/application',
		component: import('./routes/lottery-application/lottery-application-route'),
		title: 'My Lottery Application',
	},
	// My Tickets (roadmap ⑤, task 5.1). Authenticated by default — tickets are
	// account-bound covered tickets issued from captured lottery wins (④).
	// Wired into the bottom nav bar as the Tickets tab.
	{
		path: 'tickets',
		component: import('./routes/tickets/tickets-route'),
		title: 'My Tickets',
		data: { titleKey: 'nav.tickets' },
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
]

/**
 * Normalize a router path to a bare route path: drop a leading slash and any
 * query string / fragment, leaving e.g. `dashboard` or `concerts/abc-123`.
 */
function normalizePath(path: string): string {
	return path.replace(/^\//, '').split(/[?#]/)[0]
}

/**
 * Match a concrete path against a configured route pattern, treating `:param`
 * segments as wildcards (e.g. `concerts/:id` matches `concerts/abc-123`).
 */
function pathMatches(pattern: string, actual: string): boolean {
	if (pattern === actual) return true
	const p = pattern.split('/')
	const a = actual.split('/')
	if (p.length !== a.length) return false
	return p.every((seg, i) => seg.startsWith(':') || seg === a[i])
}

/**
 * Optimistic page identity for a navigation-start target path: the target
 * route's `data.titleKey` / `data.morphTitle` and the (normalized) path used to
 * compute the active nav tab. A path with no configured `titleKey` (legal,
 * about, not-found, …) resolves to an empty title, so the shell renders no
 * header — matching the pre-change behavior on those routes.
 */
export function resolvePageIdentity(path: string): PageIdentity {
	const clean = normalizePath(path)
	for (const r of routes) {
		const data = (r as { data?: { titleKey?: string; morphTitle?: boolean } })
			.data
		if (data?.titleKey && pathMatches(r.path, clean)) {
			return {
				titleKey: data.titleKey,
				morphTitle: data.morphTitle === true,
				activePath: clean,
			}
		}
	}
	return { titleKey: '', morphTitle: false, activePath: clean }
}

@route({
	title: 'Liverty Music',
	routes,
	fallback: import('./routes/not-found/not-found-route'),
})
export class AppShell {
	private readonly router = resolve(IRouter)
	private readonly routerEvents = resolve(IRouterEvents)
	public readonly auth = resolve(IAuthService)
	public readonly onboarding = resolve(IOnboardingService)
	public readonly coachMark = resolve(ICoachMarkService)
	// Global FAB action launcher registry. The shell owns the single launcher
	// instance and gates its visibility on `showNav && actions.length`.
	public readonly fabMenu = resolve(IFabMenuService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	// Shared page-identity state driven from the router lifecycle below and read
	// by the shell-hosted <page-header> and the bottom nav bar.
	public readonly pageHeader = resolve(IPageHeaderState)
	private readonly logger = resolve(ILogger).scopeTo('AppShell')

	// Eagerly construct PwaInstallService so its `beforeinstallprompt` listener
	// is registered before any routing begins. AppShell activates ahead of the
	// first navigation, so this captures the event Chrome fires during the
	// `/auth/callback` page load — otherwise the prompt is silently lost.
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: held only for its DI construction side-effect (listener registration)
	private readonly _pwaInstall = resolve(IPwaInstallService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)

	private readonly subscriptions: IDisposable[] = []

	// Suppresses the pwa-install-banner while a post-signup surface (celebration
	// overlay or PostSignupDialog) occupies the bottom of the screen so they do
	// not overlap (D7). Reactive because the coordinator flag is an `@observable`.
	public get isPostSignupSurfaceOpen(): boolean {
		return this.promptCoordinator.isPostSignupSurfaceOpen
	}

	// Updated on every navigation-end via route data `nav: false`.
	// Defaults to true so authenticated routes show the nav bar immediately.
	public showNav = true

	public binding(): void {
		// Optimistic: switch page identity at navigation intent, from the target
		// route, so the header title and active tab move before the incoming route
		// module loads and its entrance transition begins.
		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-start', (event) => {
				this.pageHeader.setOptimistic(
					resolvePageIdentity(event.instructions.toPath()),
				)
			}),
		)

		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-error', (event) => {
				this.logger.error('Navigation error', { event })
				this.errorBoundary.captureError(
					event.error ?? 'Navigation failed',
					'router:navigation-error',
				)
				// Restore the last confirmed identity so the header title and active
				// tab keep matching the route that remains displayed.
				this.pageHeader.rollback()
			}),
		)

		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-end', () => {
				const node = this.router.routeTree.root.children[0]
				this.showNav = node?.data?.nav !== false
				const name = node?.path ?? 'unknown'
				this.errorBoundary.addBreadcrumb('navigation', name)
				// Authoritative reconcile: overrides the optimistic guess so redirects,
				// the not-found fallback, and dynamic titles are reflected correctly.
				this.pageHeader.confirm(this.identityFromNode(node))
			}),
		)
	}

	/**
	 * Resolve the confirmed page identity from the current route node: the route's
	 * `data.titleKey` / `data.morphTitle` and its absolute path. A node without a
	 * `titleKey` (legal, about, fallback, …) yields an empty title, so the shell
	 * renders no header for it.
	 */
	private identityFromNode(
		node:
			| {
					data?: { titleKey?: string; morphTitle?: boolean; nav?: boolean }
					computeAbsolutePath?: () => string
			  }
			| undefined,
	): PageIdentity {
		const data = node?.data ?? {}
		return {
			titleKey: data.titleKey ?? '',
			morphTitle: data.morphTitle === true,
			activePath: node?.computeAbsolutePath?.() ?? '',
		}
	}

	public unbinding(): void {
		for (const sub of this.subscriptions) {
			sub.dispose()
		}
		this.subscriptions.length = 0
	}
}
