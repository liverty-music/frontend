import {
	ICurrentRoute,
	IRouter,
	IRouterEvents,
	type RouteNode,
	route,
} from '@aurelia/router'
import { type IDisposable, ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { ICoachMarkService } from './services/coach-mark-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { IFabMenuService } from './services/fab-menu-service'
import { IOnboardingService } from './services/onboarding-service'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IPwaInstallService } from './services/pwa-install-service'

/**
 * Shell-owned route data. Page identity lives here and nowhere else: the shell
 * header renders `titleKey` (routes without one render no header), and a route
 * with `nav: true` is a bottom-nav tab rendered from the router's navigation
 * model with `icon` / `labelKey`. `chrome: false` hides the header, nav bar and
 * other shell chrome (welcome, auth callback).
 */
export interface ShellRouteData {
	auth?: boolean
	chrome?: boolean
	titleKey?: string
	icon?: string
	labelKey?: string
}

// Route table. The router's `nav` defaults to true, so `withNavDefault` below
// flips it: only the five tab routes opt in with `nav: true`, and the bottom
// nav shows them in their order here (Home, Discovery, My Artists, Tickets,
// Settings).
const routeTable = [
	{
		path: '',
		redirectTo: 'welcome',
	},
	{
		path: 'welcome',
		component: import('./routes/welcome/welcome-route'),
		title: 'Welcome',
		data: { auth: false, chrome: false },
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
		data: { auth: false, chrome: false },
	},
	{
		// `concerts/:id` is a deep-link into the same dashboard (it opens the
		// concert's detail sheet), so it is a second path of this route: the
		// navigation model then highlights Home for it with no special case.
		id: 'dashboard',
		path: ['dashboard', 'concerts/:id'],
		component: import('./routes/dashboard/dashboard-route'),
		// The document title still tells the two paths apart: a deep-link (e.g.
		// from a push notification) opens a concert, not the bare timetable.
		title: (node: RouteNode) =>
			node.path.startsWith('concerts/') ? 'Concert' : 'Dashboard',
		nav: true,
		data: { titleKey: 'nav.home', icon: 'home', labelKey: 'nav.home' },
	},
	{
		path: 'discovery',
		component: import('./routes/discovery/discovery-route'),
		title: 'Discovery',
		nav: true,
		data: {
			auth: false,
			titleKey: 'nav.discovery',
			icon: 'discovery',
			labelKey: 'nav.discovery',
		},
	},
	{
		path: 'my-artists',
		component: import('./routes/my-artists/my-artists-route'),
		title: 'My Artists',
		nav: true,
		data: {
			titleKey: 'nav.myArtists',
			icon: 'my-artists',
			labelKey: 'nav.myArtists',
		},
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
		nav: true,
		// Uses the existing 'ticket' icon (svg-icon.html case="ticket").
		data: { titleKey: 'nav.tickets', icon: 'ticket', labelKey: 'nav.tickets' },
	},
	{
		path: 'settings',
		component: import('./routes/settings/settings-route'),
		title: 'Settings',
		nav: true,
		data: {
			titleKey: 'nav.settings',
			icon: 'settings',
			labelKey: 'nav.settings',
		},
	},
	// Order detail (roadmap ⑤, §5.1/§5.2). Authenticated by default — the order
	// must belong to the caller (non-revealing NotFound otherwise). Reached by
	// link from My Tickets; NOT wired into the bottom nav.
	{
		path: 'orders/:orderId',
		component: import('./routes/order/order-route'),
		title: 'Order Detail',
		data: { titleKey: 'nav.order' },
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
 * Apply the shell's `nav: false` default, so a route is a bottom-nav tab only
 * when it says so (the router's own default is `nav: true`). Redirects are left
 * as they are: the router accepts only `path` / `redirectTo` on them, and keeps
 * them out of the navigation model anyway.
 */
function withNavDefault<T extends { nav?: boolean; redirectTo?: string }>(
	table: T[],
): T[] {
	return table.map((r) =>
		r.redirectTo === undefined ? { nav: false, ...r } : r,
	)
}

export const routes = withNavDefault(routeTable)

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
	// The router's record of the displayed route, updated on navigation-end.
	private readonly currentRoute = resolve(ICurrentRoute)
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

	/**
	 * i18n key of the displayed route's header title (`data.titleKey`), or empty
	 * for a route without one (legal, about, the not-found fallback), which then
	 * renders no header. Read from the router's current route, so it changes
	 * only when a navigation completes.
	 */
	public get titleKey(): string {
		const data = this.currentRoute.parameterInformation[0]?.config?.data as
			| ShellRouteData
			| undefined
		return data?.titleKey ?? ''
	}

	// Updated on every navigation-end via route data `chrome: false`.
	// Defaults to true so authenticated routes show the nav bar immediately.
	public showNav = true

	public binding(): void {
		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-error', (event) => {
				this.logger.error('Navigation error', { event })
				this.errorBoundary.captureError(
					event.error ?? 'Navigation failed',
					'router:navigation-error',
				)
			}),
		)

		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-end', () => {
				const node = this.router.routeTree.root.children[0]
				this.showNav = (node?.data as ShellRouteData)?.chrome !== false
				const name = node?.path ?? 'unknown'
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
