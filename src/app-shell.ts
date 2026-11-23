import { ICurrentRoute, IRouter, IRouterEvents, route } from '@aurelia/router'
import { type IDisposable, ILogger, resolve, watch } from 'aurelia'
import { createRouteModules } from './route-modules'
import { pathOf, type RouteName, titleKeyOf } from './route-specs'
import {
	IActionMenuService,
	settingsAction,
} from './services/action-menu-service'
import { IAuthService } from './services/auth-service'
import { IBottomSheetTracker } from './services/bottom-sheet-tracker'
import { IErrorBoundaryService } from './services/error-boundary-service'
import { INotificationStore } from './services/notification-store'
import { IOnboardingService } from './services/onboarding-service'
import { IPromptCoordinator } from './services/prompt-coordinator'
import { IPwaInstallService } from './services/pwa-install-service'
import { IScreenTransition } from './services/screen-transition'
import {
	NOTIFICATION_OPENED_MESSAGE,
	NOTIFICATION_QUERY_PARAM,
} from './util/notification-link'

/**
 * Shell-owned route data. Page identity lives here and nowhere else: every
 * route names its title with `titleKey` (a `nav.*` key, the screen's one
 * English title), which the shell header shows and the browser tab title is
 * built from. `header: false` keeps the header hidden on a screen that shows
 * none. A route with `nav: true` is a bottom-nav tab rendered from the
 * router's navigation model with `icon` / `labelKey`. `chrome: false` hides
 * the header, nav bar and other shell chrome (welcome, sign-in callback).
 * `section` names the tab route (by `id`) a non-tab route belongs to, so the
 * bottom nav highlights that tab while it is displayed (the concert page
 * belongs to Timetable).
 */
export interface ShellRouteData {
	auth?: boolean
	chrome?: boolean
	header?: boolean
	titleKey?: string
	icon?: string
	labelKey?: string
	section?: string
}

// Routes off the bottom navigation import their module when first navigated
// to (see `createRouteModules`); the others are imported once the first route
// is on screen.
const { lazyRoute, prefetch: prefetchRouteModules } = createRouteModules()

/**
 * The id, address and title key of a screen, from `ROUTE_SPECS`. The route
 * id is the screen's name, so the bottom nav's `data-nav` and a `section`
 * name the screen as its spec does.
 */
function screen(name: RouteName): {
	id: string
	path: string
} {
	return { id: name, path: pathOf(name) }
}

// Route table. The router's `nav` defaults to true, so `withNavDefault` below
// flips it: only the four tab routes opt in with `nav: true`, and the bottom
// nav shows them in their order here (Timetable, Discovery, My Artists,
// Tickets), two on each side of the action menu's centre slot.
const routeTable = [
	{
		path: '',
		redirectTo: 'welcome',
	},
	{
		...screen('welcome'),
		component: lazyRoute(() => import('./routes/welcome/welcome-route')),
		data: { auth: false, chrome: false, titleKey: titleKeyOf('welcome') },
	},
	{
		...screen('about'),
		component: lazyRoute(() => import('./routes/about/about-route')),
		data: { auth: false, header: false, titleKey: titleKeyOf('about') },
	},
	{
		...screen('sign-in-callback'),
		component: lazyRoute(
			() => import('./routes/sign-in-callback/sign-in-callback-route'),
		),
		data: {
			auth: false,
			chrome: false,
			titleKey: titleKeyOf('sign-in-callback'),
		},
	},
	{
		// Return leg of the fresh sign-in of passkey management and the
		// withdrawal screen (a second OIDC client with a short-lived, in-memory
		// token; OpenSpec changes `fan-passkey-recovery-and-management` D3 and
		// `delete-fan-accounts` D4).
		...screen('passkeys-callback'),
		component: lazyRoute(
			() => import('./routes/passkeys-callback/passkeys-callback-route'),
		),
		data: {
			auth: false,
			chrome: false,
			titleKey: titleKeyOf('passkeys-callback'),
		},
	},
	{
		// The "can't sign in" screen: guests and signed-in fans ask for an email
		// link that registers a new passkey.
		...screen('sign-in-help'),
		component: lazyRoute(
			() => import('./routes/sign-in-help/sign-in-help-route'),
		),
		data: { auth: false, titleKey: titleKeyOf('sign-in-help') },
	},
	{
		// The link of a verification email opens here, on any device and
		// without sign-in; the fan confirms the address with one tap
		// (OpenSpec change `fan-email-verification-in-app`, design D4).
		...screen('verify-email'),
		component: lazyRoute(
			() => import('./routes/verify-email/verify-email-route'),
		),
		data: { auth: false, titleKey: titleKeyOf('verify-email') },
	},
	{
		// The open concert sheet is the `concert` query parameter of this
		// address, like the filters, so the route has one path.
		...screen('timetable'),
		component: import('./routes/timetable/timetable-route'),
		nav: true,
		data: {
			titleKey: titleKeyOf('timetable'),
			icon: 'home',
			labelKey: titleKeyOf('timetable'),
		},
	},
	{
		// The public, shareable page of one first-party Concert. Guests open it
		// from shared links, so it does not wait for auth readiness. It belongs
		// to Timetable: the timetable's first-party cards open it.
		...screen('concert'),
		component: lazyRoute(() => import('./routes/concert/concert-route')),
		data: {
			auth: false,
			header: false,
			titleKey: titleKeyOf('concert'),
			section: 'timetable',
		},
	},
	{
		// The checkout of one TicketStock (seat type, `?stock=`) of a Concert,
		// in its first-come sale. Signed-in fans only; a guest is sent through
		// sign-up from the concert page.
		...screen('checkout'),
		component: lazyRoute(() => import('./routes/checkout/checkout-route')),
		data: { titleKey: titleKeyOf('checkout'), section: 'timetable' },
	},
	{
		...screen('discovery'),
		component: import('./routes/discovery/discovery-route'),
		nav: true,
		data: {
			auth: false,
			titleKey: titleKeyOf('discovery'),
			icon: 'discovery',
			labelKey: titleKeyOf('discovery'),
		},
	},
	{
		...screen('my-artists'),
		component: import('./routes/my-artists/my-artists-route'),
		nav: true,
		data: {
			titleKey: titleKeyOf('my-artists'),
			icon: 'my-artists',
			labelKey: titleKeyOf('my-artists'),
		},
	},
	{
		// Public, directly-linkable privacy/analytics screen. Consent
		// application logic lives in ConsentService.
		...screen('consent'),
		component: lazyRoute(() => import('./routes/consent/consent-route')),
		data: { auth: false, header: false, titleKey: titleKeyOf('consent') },
	},
	// PocketSign Stamp callback (identity-ekyc-jpki, Stamp redirect flow).
	// The PocketSign app returns here after the fan reads their card. Auth is
	// required: the fan must be authenticated when they return from the app.
	// No `auth: false` — the AuthHook guards this route.
	{
		...screen('identity-verification-callback'),
		component: lazyRoute(
			() =>
				import(
					'./routes/identity-verification-callback/identity-verification-callback-route'
				),
		),
		data: {
			header: false,
			titleKey: titleKeyOf('identity-verification-callback'),
		},
	},
	// The lottery entry of one TicketStock (seat type, `?stock=`) of a Concert
	// in a lottery sale (`?sale=`), opened from the concert page's ticket
	// section. Signed-in fans only; a guest is sent through sign-up from the
	// concert page.
	{
		...screen('new-lottery-entry'),
		component: lazyRoute(
			() => import('./routes/new-lottery-entry/new-lottery-entry-route'),
		),
		data: { titleKey: titleKeyOf('new-lottery-entry'), section: 'timetable' },
	},
	// The fan's entries in that sale (`?sale=`) and their states. Reached
	// from the entry screen once the entry is made.
	{
		...screen('lottery-entries'),
		component: lazyRoute(
			() => import('./routes/lottery-entries/lottery-entries-route'),
		),
		data: { titleKey: titleKeyOf('lottery-entries'), section: 'timetable' },
	},
	// The application for official resale tickets of one sold-out TicketStock
	// (seat type, `?stock=`) of a Concert, opened from the concert page's
	// ticket section. Signed-in fans only; a guest is sent through sign-up from
	// the concert page.
	{
		...screen('new-resale-entry'),
		component: lazyRoute(
			() => import('./routes/new-resale-entry/new-resale-entry-route'),
		),
		data: { titleKey: titleKeyOf('new-resale-entry'), section: 'timetable' },
	},
	// The fan's resale entries and their states; the resale emails link here.
	{
		...screen('resale-entries'),
		component: lazyRoute(
			() => import('./routes/resale-entries/resale-entries-route'),
		),
		data: { titleKey: titleKeyOf('resale-entries'), section: 'timetable' },
	},
	// Tickets: account-bound tickets issued from captured lottery wins and
	// purchases. A bottom-nav tab.
	{
		...screen('tickets'),
		component: import('./routes/tickets/tickets-route'),
		nav: true,
		// Uses the existing 'ticket' icon (svg-icon.html case="ticket").
		data: {
			titleKey: titleKeyOf('tickets'),
			icon: 'ticket',
			labelKey: titleKeyOf('tickets'),
		},
	},
	// The notification center opens from the bell in the header; not a tab.
	{
		...screen('notifications'),
		component: lazyRoute(
			() => import('./routes/notifications/notifications-route'),
		),
		data: { titleKey: titleKeyOf('notifications') },
	},
	// Settings is not a tab: it opens from the last item of the action menu on
	// the four tab pages (`isTabRoute`), and highlights no tab.
	{
		...screen('settings'),
		component: lazyRoute(() => import('./routes/settings/settings-route')),
		data: { titleKey: titleKeyOf('settings') },
	},
	// Passkey management, opened from the Settings Passkeys row. Signed-in
	// fans only; its canLoad requires the passkey-management token.
	{
		...screen('passkeys'),
		component: lazyRoute(() => import('./routes/passkeys/passkeys-route')),
		data: { titleKey: titleKeyOf('passkeys') },
	},
	// The withdrawal screen, opened from the Settings Delete account control.
	// Signed-in fans only; it asks for the same fresh sign-in as passkey
	// management before it deletes (OpenSpec change `delete-fan-accounts`).
	{
		...screen('delete-account'),
		component: lazyRoute(
			() => import('./routes/delete-account/delete-account-route'),
		),
		data: { titleKey: titleKeyOf('delete-account') },
	},
	// Order detail. Authenticated by default — the order must belong to the
	// caller (non-revealing NotFound otherwise). Reached by link from Tickets;
	// NOT wired into the bottom nav.
	{
		...screen('order'),
		component: lazyRoute(() => import('./routes/order/order-route')),
		data: { titleKey: titleKeyOf('order') },
	},
	// Legal documents. Public (`auth: false`) so guests can open them
	// without an account, and so each has a stable, directly-linkable URL
	// (the product ships as a PWA only — there is no app-store listing).
	// Linked from Settings via the root router (SettingsRoute.openLegal),
	// not a `load`/`href` attribute: the attribute would resolve relative to
	// the Settings routing context (`/settings/legal/terms` → AUR3174).
	{
		...screen('legal/terms'),
		component: lazyRoute(() => import('./routes/legal/terms-route')),
		data: { auth: false, header: false, titleKey: titleKeyOf('legal/terms') },
	},
	{
		...screen('legal/privacy'),
		component: lazyRoute(() => import('./routes/legal/privacy-route')),
		data: {
			auth: false,
			header: false,
			titleKey: titleKeyOf('legal/privacy'),
		},
	},
	{
		...screen('legal/licenses'),
		component: lazyRoute(() => import('./routes/legal/licenses-route')),
		data: {
			auth: false,
			header: false,
			titleKey: titleKeyOf('legal/licenses'),
		},
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
	private readonly screenTransition = resolve(IScreenTransition)
	public readonly auth = resolve(IAuthService)
	public readonly onboarding = resolve(IOnboardingService)
	public readonly notifications = resolve(INotificationStore)
	// Global FAB action launcher registry. The shell owns the single launcher
	// instance and gates its visibility on `showNav && actions.length`.
	public readonly actionMenu = resolve(IActionMenuService)
	// The launcher's last item on the tab pages: the only way into Settings.
	private readonly settingsItem = settingsAction(() => {
		void this.router.load('settings')
	})
	// Open bottom sheets, app-wide: the FAB steps aside while any is open.
	public readonly sheets = resolve(IBottomSheetTracker)
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
	 * for a route that shows no page header (`data.header: false`: about, the
	 * concert page, legal, the not-found fallback), which then renders no
	 * header. Read from the router's current route, so it changes only when a
	 * navigation completes.
	 */
	public get titleKey(): string {
		const data = this.currentRoute.parameterInformation[0]?.config?.data as
			| ShellRouteData
			| undefined
		if (data?.header === false) return ''
		return data?.titleKey ?? ''
	}

	/**
	 * Whether the displayed route is one of the bottom-nav tabs (`nav: true`).
	 * The FAB launcher ends with the Settings item only there.
	 */
	public get isTabRoute(): boolean {
		return this.currentRoute.parameterInformation[0]?.config?.nav === true
	}

	@watch((vm: AppShell) => vm.isTabRoute)
	protected isTabRouteChanged(): void {
		this.applySettingsItem()
	}

	private applySettingsItem(): void {
		this.actionMenu.setTrailing(this.isTabRoute ? this.settingsItem : null)
	}

	// Updated on every navigation-end via route data `chrome: false`.
	// Defaults to true so authenticated routes show the nav bar immediately.
	public showNav = true
	private routeModulesPrefetched = false

	/** The bell in the header opens the notification center. */
	public openNotifications(): void {
		void this.router.load('notifications')
	}

	// Refreshes the bell when a sign-in completes after the app started.
	@watch((vm: AppShell) => vm.auth.isAuthenticated)
	protected isAuthenticatedChanged(): void {
		void this.notifications.refresh()
	}

	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState === 'visible') {
			void this.notifications.refresh()
		}
	}

	/**
	 * Marks the notification read whose push the fan opened: the Service Worker
	 * names it in the URL, because it holds no access token. A guest's stays
	 * unread. The parameter is removed either way, so it never lingers in a URL
	 * the fan shares or reloads.
	 */
	private async markOpenedNotification(): Promise<void> {
		const url = new URL(window.location.href)
		const id = url.searchParams.get(NOTIFICATION_QUERY_PARAM)
		if (!id) return
		url.searchParams.delete(NOTIFICATION_QUERY_PARAM)
		window.history.replaceState(window.history.state, '', url)
		await this.markReadIfSignedIn(id)
	}

	/**
	 * Marks the notification read whose push the fan opened while this window
	 * was already on its page: the Service Worker brings the window to the front
	 * and names the notification in a message instead of the URL.
	 */
	private readonly onServiceWorkerMessage = (event: MessageEvent): void => {
		const data = event.data as
			| { type?: string; notificationId?: string }
			| undefined
		if (data?.type === NOTIFICATION_OPENED_MESSAGE && data.notificationId) {
			void this.markReadIfSignedIn(data.notificationId)
		}
	}

	/** A guest's notification stays unread. */
	private async markReadIfSignedIn(id: string): Promise<void> {
		await this.auth.ready
		if (this.auth.isAuthenticated) {
			await this.notifications.markRead(id)
		}
	}

	public binding(): void {
		this.applySettingsItem()
		void this.auth.ready.then(() => this.notifications.refresh())
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		navigator.serviceWorker?.addEventListener(
			'message',
			this.onServiceWorkerMessage,
		)
		this.subscriptions.push(this.screenTransition.watch())
		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-error', (event) => {
				this.logger.error('Navigation error', { event })
				this.errorBoundary.captureError(
					event.error ?? 'Navigation failed',
					'router_navigation_error',
				)
			}),
		)

		this.subscriptions.push(
			this.routerEvents.subscribe('au:router:navigation-end', () => {
				if (!this.routeModulesPrefetched) {
					// The first route is on screen: import the others when idle.
					this.routeModulesPrefetched = true
					prefetchRouteModules()
				}
				const node = this.router.routeTree.root.children[0]
				this.showNav = (node?.data as ShellRouteData)?.chrome !== false
				const name = node?.path ?? 'unknown'
				this.errorBoundary.addBreadcrumb('navigation', name)
				void this.markOpenedNotification()
			}),
		)
	}

	public unbinding(): void {
		for (const sub of this.subscriptions) {
			sub.dispose()
		}
		this.subscriptions.length = 0
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		navigator.serviceWorker?.removeEventListener(
			'message',
			this.onServiceWorkerMessage,
		)
		this.actionMenu.setTrailing(null)
	}
}
