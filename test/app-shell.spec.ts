import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter, RouterConfiguration } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app-shell'
import { BottomNavBar } from '../src/components/bottom-nav-bar/bottom-nav-bar'
import { NotificationBell } from '../src/components/notification-bell/notification-bell'
import { PageHeader } from '../src/components/page-header/page-header'
import { SvgIcon } from '../src/components/svg-icon/svg-icon'
import { IAnalyticsService } from '../src/lib/analytics/analytics-service'
import { IAuthService } from '../src/services/auth-service'
import { IBottomSheetTracker } from '../src/services/bottom-sheet-tracker'
import { IErrorBoundaryService } from '../src/services/error-boundary-service'
import { IFabMenuService } from '../src/services/fab-menu-service'
import { INotificationManager } from '../src/services/notification-manager'
import { INotificationStore } from '../src/services/notification-store'
import { IOnboardingService } from '../src/services/onboarding-service'
import { IPromptCoordinator } from '../src/services/prompt-coordinator'
import { IPushService } from '../src/services/push-service'
import { IPwaInstallService } from '../src/services/pwa-install-service'
import { myArtistsGuard } from './helpers/route-stubs'

// Route modules are replaced by one-element stubs so the real router can load
// and display them without each route's full component tree.
const { stub } = vi.hoisted(() => ({
	stub: (name: string) => () =>
		import('./helpers/route-stubs').then((m) => m.routeModule(name)),
}))
vi.mock('../src/routes/welcome/welcome-route', stub('WelcomeRoute'))
vi.mock('../src/routes/about/about-route', stub('AboutRoute'))
vi.mock(
	'../src/routes/auth-callback/auth-callback-route',
	stub('AuthCallbackRoute'),
)
vi.mock('../src/routes/dashboard/dashboard-route', stub('DashboardRoute'))
vi.mock('../src/routes/event/event-route', stub('EventRoute'))
vi.mock('../src/routes/discovery/discovery-route', stub('DiscoveryRoute'))
vi.mock('../src/routes/my-artists/my-artists-route', stub('MyArtistsRoute'))
vi.mock('../src/routes/settings/settings-route', stub('SettingsRoute'))
vi.mock('../src/routes/consent/consent-route', stub('ConsentRoute'))
vi.mock(
	'../src/routes/verify-callback/verify-callback-route',
	stub('VerifyCallbackRoute'),
)
vi.mock(
	'../src/routes/lottery-entry/lottery-entry-route',
	stub('LotteryEntryRoute'),
)
vi.mock(
	'../src/routes/lottery-entry-status/lottery-entry-status-route',
	stub('LotteryEntryStatusRoute'),
)
vi.mock('../src/routes/legal/terms-route', stub('TermsRoute'))
vi.mock('../src/routes/legal/privacy-route', stub('PrivacyRoute'))
vi.mock('../src/routes/legal/licenses-route', stub('LicensesRoute'))
vi.mock('../src/routes/tickets/tickets-route', stub('TicketsRoute'))
vi.mock('../src/routes/order/order-route', stub('OrderRoute'))
vi.mock('../src/routes/not-found/not-found-route', stub('NotFoundRoute'))
vi.mock(
	'../src/routes/passkey-recovery/passkey-recovery-route',
	stub('PasskeyRecoveryRoute'),
)
vi.mock(
	'../src/routes/verify-email/verify-email-route',
	stub('VerifyEmailRoute'),
)
vi.mock(
	'../src/routes/passkeys-callback/passkeys-callback-route',
	stub('PasskeysCallbackRoute'),
)
vi.mock('../src/routes/passkeys/passkeys-route', stub('PasskeysRoute'))
vi.mock(
	'../src/routes/notifications/notifications-route',
	stub('NotificationsRoute'),
)
vi.mock(
	'../src/routes/delete-account/delete-account-route',
	stub('DeleteAccountRoute'),
)

const PAGE_HEADER = 'page-header'
const BOTTOM_NAV = 'bottom-nav-bar'

/**
 * Renders the real AppShell (template, route table and fallback) under the
 * real router. These are the assertions an Aurelia upgrade would most
 * plausibly break — template compilation, `if.bind` evaluation, viewport
 * registration and the router's navigation model — and Aurelia automerge is
 * gated on them (OpenSpec change `automate-dependency-updates`, design D17).
 * Do not re-skip.
 */
describe('app-shell', () => {
	let fixture: Awaited<ReturnType<typeof renderShell>>
	let router: IRouter
	let captureError: ReturnType<typeof vi.fn>

	interface ShellState {
		isAuthenticated?: boolean
		onboarding?: { isOnboarding: boolean; isCompleted: boolean }
		unreadCount?: number
	}

	let notificationStore: {
		unreadCount: number
		refresh: ReturnType<typeof vi.fn>
		markRead: ReturnType<typeof vi.fn>
	}

	async function renderShell(state: ShellState = {}) {
		captureError = vi.fn()
		notificationStore = {
			unreadCount: state.unreadCount ?? 0,
			refresh: vi.fn(async () => {}),
			markRead: vi.fn(async () => {}),
		}
		const shell = createFixture(
			CustomElement.getDefinition(AppShell).template as string,
			AppShell,
			[
				RouterConfiguration,
				// Child CEs in the shell template (error-banner, snack-bar, …)
				// resolve I18N at construction, so the real plugin is registered;
				// with no resources `t` renders the key itself.
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'en',
						resources: { en: { translation: {} } },
						fallbackLng: 'en',
						interpolation: { escapeValue: false },
					}
				}),
				BottomNavBar,
				PageHeader,
				NotificationBell,
				SvgIcon,
				Registration.instance(INotificationStore, notificationStore),
				Registration.instance(IErrorBoundaryService, {
					captureError,
					addBreadcrumb: vi.fn(),
				}),
				Registration.instance(IAuthService, {
					isAuthenticated: state.isAuthenticated ?? false,
					ready: Promise.resolve(),
				}),
				Registration.instance(IOnboardingService, {
					isOnboarding: false,
					isCompleted: false,
					...state.onboarding,
					currentStep: 'lp',
					spotlightActive: false,
					spotlightTarget: '',
					spotlightMessage: '',
					spotlightRadius: '12px',
				}),
				// AppShell eagerly resolves IPwaInstallService; a stub keeps DI from
				// constructing the real one, which reads `window.matchMedia`. The
				// app is not installed, so the banner shows wherever it is mounted.
				// A signed-in, onboarded fan also mounts the notification prompt;
				// its push dependencies are stubbed (permission granted, so it
				// stays hidden).
				Registration.instance(IPushService, {}),
				Registration.instance(IAnalyticsService, { capture: vi.fn() }),
				Registration.instance(INotificationManager, { permission: 'granted' }),
				Registration.instance(IPwaInstallService, {
					canShowFab: false,
					isIos: false,
					shouldShowInstallBanner: true,
				}),
			],
		)
		await shell.started
		return shell
	}

	async function go(path: string): Promise<void> {
		await router.load(path).catch(() => undefined)
		await tasksSettled()
	}

	const host = () => fixture.appHost
	const displayedRoute = () =>
		host().querySelector('au-viewport [data-route]')?.getAttribute('data-route')
	const headerTitle = () =>
		host().querySelector(`${PAGE_HEADER} h1`)?.textContent ?? null
	const activeTabs = () =>
		[...host().querySelectorAll(`${BOTTOM_NAV} [data-active="true"]`)].map(
			(a) => a.getAttribute('data-nav'),
		)

	/** Whether `action` changes anything in the page header or the nav bar. */
	async function identityWritesDuring(action: () => Promise<void>) {
		const writes: MutationRecord[] = []
		const observer = new MutationObserver((records) => writes.push(...records))
		observer.observe(host(), {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['data-active'],
		})
		await action()
		writes.push(...observer.takeRecords())
		observer.disconnect()
		const isIdentity = (n: Node | null): boolean =>
			n instanceof Element && n.closest(`${PAGE_HEADER}, ${BOTTOM_NAV}`) != null
		return writes.some(
			(r) =>
				r.type === 'attributes' ||
				isIdentity(r.target) ||
				isIdentity(r.target.parentElement) ||
				[...r.addedNodes, ...r.removedNodes].some(isIdentity),
		)
	}

	beforeEach(async () => {
		window.history.replaceState(null, '', '/')
		myArtistsGuard.allow = true
		myArtistsGuard.fail = false
		fixture = await renderShell()
		router = fixture.container.get(IRouter)
	})

	afterEach(async () => {
		await fixture.stop(true)
	})

	describe('shell rendering', () => {
		it('renders the routing viewport', () => {
			expect(host().querySelector('au-viewport')).not.toBeNull()
		})

		it('renders the navigation bar when the route shows chrome', async () => {
			await go('discovery')
			expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
		})
	})

	describe('chrome', () => {
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Navigation hidden on Landing Page and auth callback only"
		it.each(['welcome', 'auth/callback', 'auth/passkeys-callback'])(
			'hides the header and nav bar on %s (data.chrome: false)',
			async (path) => {
				await go('discovery')
				await go(path)
				expect(host().querySelector(BOTTOM_NAV)).toBeNull()
				expect(host().querySelector(PAGE_HEADER)).toBeNull()
			},
		)

		it('opens the passkey recovery screen for a guest', async () => {
			await go('passkey-recovery')
			expect(displayedRoute()).toBe('passkey-recovery-route')
			expect(headerTitle()).toBe('passkeyRecovery.title')
		})

		it('opens the email verification screen for a guest', async () => {
			await go('verify-email')
			expect(displayedRoute()).toBe('verify-email-route')
			expect(headerTitle()).toBe('verifyEmail.title')
		})

		it('shows the nav bar again when leaving a chrome-less route', async () => {
			await go('welcome')
			await go('settings')
			expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
		})
	})

	describe('page identity', () => {
		// @spec components/infrastructure/fan/web/global/page-header "Header title and active tab match the route shown"
		it('shows the displayed tab route’s title and highlights its tab', async () => {
			// Settings is not a tab: its header still reads the invariant tab
			// label `nav.settings`, and no tab is highlighted.
			// @spec components/infrastructure/fan/web/route/settings "Header shares the navigation tab label source"
			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Route outside every tab"
			await go('settings')
			expect(headerTitle()).toBe('nav.settings')
			expect(activeTabs()).toEqual([])

			await go('my-artists')
			expect(headerTitle()).toBe('nav.myArtists')
			expect(activeTabs()).toEqual(['my-artists'])

			await go('dashboard')
			expect(headerTitle()).toBe('nav.home')
			expect(activeTabs()).toEqual(['home'])
		})

		// @spec components/infrastructure/fan/web/global/page-header "A failed navigation leaves identity unchanged"
		it.each([
			[
				'cancelled by a guard',
				() => {
					myArtistsGuard.allow = false
				},
			],
			[
				'failed in a guard',
				() => {
					myArtistsGuard.fail = true
				},
			],
		])(
			'keeps the previous identity when the navigation is %s',
			async (_, block) => {
				await go('settings')
				block()

				// No write to the header or the tab highlight may happen while the
				// failing navigation runs.
				expect(await identityWritesDuring(() => go('my-artists'))).toBe(false)

				expect(displayedRoute()).toBe('settings-route')
				expect(headerTitle()).toBe('nav.settings')
				expect(activeTabs()).toEqual([])

				// Control: the same observation does see a navigation that succeeds.
				myArtistsGuard.allow = true
				myArtistsGuard.fail = false
				expect(await identityWritesDuring(() => go('my-artists'))).toBe(true)
			},
		)

		// @spec components/infrastructure/fan/web/global/page-header "Redirects and the fallback route are reflected"
		it('reflects the not-found fallback, not the requested path', async () => {
			await go('settings')
			await go('no/such/page')
			expect(displayedRoute()).toBe('not-found-route')
			expect(host().querySelector(PAGE_HEADER)).toBeNull()
			expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
			expect(activeTabs()).toEqual([])
		})

		// @spec components/infrastructure/fan/web/global/page-header "Redirects and the fallback route are reflected"
		it('reflects the redirect target, not the requested path', async () => {
			await go('settings')
			await go('')
			expect(displayedRoute()).toBe('welcome-route')
			// Welcome hides the chrome, so neither the header nor a tab remains.
			expect(host().querySelector(PAGE_HEADER)).toBeNull()
			expect(host().querySelector(BOTTOM_NAV)).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/page-header "Routes without a title show no header"
		it.each(['legal/terms', 'about'])(
			'renders no header on %s',
			async (path) => {
				await go('settings')
				await go(path)
				expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
				expect(host().querySelector(PAGE_HEADER)).toBeNull()
			},
		)
	})

	describe('single shell-hosted page header', () => {
		// @spec components/infrastructure/fan/web/global/page-header "Single shell-hosted instance across route changes"
		it('keeps one header instance and updates its title in place', async () => {
			await go('settings')
			const header = host().querySelector(PAGE_HEADER)
			expect(header).not.toBeNull()

			await go('my-artists')
			expect(host().querySelectorAll(PAGE_HEADER)).toHaveLength(1)
			expect(host().querySelector(PAGE_HEADER)).toBe(header)
			expect(headerTitle()).toBe('nav.myArtists')
		})

		// @spec components/infrastructure/fan/web/global/page-header "Title bound to the displayed route, not per-route markup"
		it('sources the title from route configuration; no route authors a header', async () => {
			await go('tickets')
			expect(headerTitle()).toBe('nav.tickets')
			expect(host().querySelector(`au-viewport ${PAGE_HEADER}`)).toBeNull()

			const templates = import.meta.glob('../src/routes/**/*.html', {
				query: '?raw',
				import: 'default',
				eager: true,
			}) as Record<string, string>
			expect(Object.keys(templates).length).toBeGreaterThan(0)
			const authoring = Object.entries(templates)
				.filter(([, html]) =>
					/<page-header[\s>]/.test(html.replace(/<!--[\s\S]*?-->/g, '')),
				)
				.map(([file]) => file)
			expect(authoring).toEqual([])
		})
	})

	describe('document title', () => {
		it('names the concert deep-link "Concert" and the dashboard "Dashboard"', async () => {
			await go('dashboard')
			expect(document.title).toMatch(/^Dashboard\b/)

			await go('concerts/concert-1')
			expect(document.title).toMatch(/^Concert\b/)

			await go('dashboard')
			expect(document.title).toMatch(/^Dashboard\b/)
		})
	})

	it('reports a failed navigation to the error boundary', async () => {
		await go('settings')
		myArtistsGuard.fail = true
		await go('my-artists')
		expect(captureError).toHaveBeenCalledWith(
			expect.anything(),
			'router_navigation_error',
		)
	})

	describe('FAB', () => {
		const fab = () => host().querySelector('fab-menu')
		const itemIds = () =>
			fixture.container.get(IFabMenuService).actions.map((a) => a.id)

		// @spec components/infrastructure/fan/web/global/fab-menu "Settings is the only item on Tickets"
		it('ends the launcher with Settings on every tab page, so Tickets shows the FAB', async () => {
			for (const tab of ['dashboard', 'discovery', 'my-artists', 'tickets']) {
				await go(tab)
				expect(itemIds().at(-1)).toBe('settings')
			}
			// Tickets contributes no action of its own.
			expect(itemIds()).toEqual(['settings'])
			expect(fab()).not.toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "No Settings item outside the tabs"
		it.each(['settings', 'events/event-1', 'orders/order-1'])(
			'offers no Settings item on %s',
			async (path) => {
				await go('dashboard')
				expect(itemIds()).toContain('settings')
				await go(path)
				expect(itemIds()).not.toContain('settings')
				// @spec components/infrastructure/fan/web/global/fab-menu "FAB hidden when no actions are contributed"
				expect(fab()).toBeNull()
			},
		)

		// @spec components/infrastructure/fan/web/global/fab-menu "Choosing Settings"
		it('displays Settings when the Settings item is chosen', async () => {
			await go('tickets')
			const item = fixture.container
				.get(IFabMenuService)
				.actions.find((a) => a.id === 'settings')
			item?.invoke()
			await new Promise((r) => setTimeout(r, 0))
			await tasksSettled()
			expect(displayedRoute()).toBe('settings-route')
		})

		// @spec components/infrastructure/fan/web/global/fab-menu "FAB hidden while a bottom sheet is open"
		it('is not shown while any bottom sheet is open and returns when it closes', async () => {
			await go('discovery')
			const dispose = fixture.container.get(IFabMenuService).register({}, [
				{
					id: 'search',
					icon: 'search',
					labelKey: 'nav.discovery',
					kind: 'command',
					invoke: vi.fn(),
				},
			])
			await tasksSettled()
			expect(fab()).not.toBeNull()

			// A bottom sheet opens.
			const sheets = fixture.container.get(IBottomSheetTracker)
			const prompt = {}
			sheets.opened(prompt)
			await tasksSettled()
			expect(fab()).toBeNull()

			// A second sheet over it; closing one keeps the FAB hidden.
			const other = {}
			sheets.opened(other)
			sheets.closed(prompt)
			await tasksSettled()
			expect(fab()).toBeNull()

			sheets.closed(other)
			await tasksSettled()
			expect(fab()).not.toBeNull()
			dispose()
		})
	})

	// The shell decides whether the install banner is mounted; the banner then
	// shows while the app is not installed (pwa-install-service.spec.ts).
	describe('notification bell', () => {
		const bell = () => host().querySelector('[data-testid="notification-bell"]')
		const badge = () =>
			host().querySelector('[data-testid="notification-bell-badge"]')
		// A signed-in fan who has not finished onboarding: the install banner, whose cue
		// restarts through getAnimations() (absent in jsdom), stays out of the shell.
		const signedIn = {
			isAuthenticated: true,
			onboarding: { isOnboarding: false, isCompleted: false },
		}

		async function renderBellAt(state: ShellState) {
			await fixture.stop(true)
			fixture = await renderShell(state)
			router = fixture.container.get(IRouter)
			await go('tickets')
		}

		// @spec components/infrastructure/fan/web/global/page-header "Two unread"
		it('shows the unread count as a badge', async () => {
			await renderBellAt({ ...signedIn, unreadCount: 2 })
			expect(badge()?.textContent).toBe('2')
		})

		// @spec components/infrastructure/fan/web/global/page-header "All read"
		it('shows no badge when every notification is read', async () => {
			await renderBellAt({ ...signedIn, unreadCount: 0 })
			expect(bell()).not.toBeNull()
			expect(badge()).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/page-header "Guest"
		it('is not shown to a guest', async () => {
			await go('discovery')
			expect(headerTitle()).not.toBeNull()
			expect(bell()).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/page-header "Open the center"
		it('opens the notification center', async () => {
			await renderBellAt(signedIn)
			;(bell() as HTMLButtonElement).click()
			await tasksSettled()
			await vi.waitFor(() =>
				expect(displayedRoute()).toBe('notifications-route'),
			)
		})

		it('refreshes on start and when the app returns to the foreground', async () => {
			await renderBellAt(signedIn)
			await vi.waitFor(() =>
				expect(notificationStore.refresh).toHaveBeenCalledTimes(1),
			)
			document.dispatchEvent(new Event('visibilitychange'))
			expect(notificationStore.refresh).toHaveBeenCalledTimes(2)
		})
	})

	describe('opening a push notification', () => {
		const NOTIFICATION = '019a0000-0000-7000-8000-000000000001'

		async function renderSignedIn(isAuthenticated: boolean) {
			await fixture.stop(true)
			window.history.replaceState(null, '', '/')
			fixture = await renderShell({ isAuthenticated })
			router = fixture.container.get(IRouter)
			notificationStore.markRead.mockClear()
		}

		// @spec components/infrastructure/fan/web/global/service-worker "Open a lottery loss notification"
		it('marks it read for a signed-in fan and removes the parameter', async () => {
			await renderSignedIn(true)

			await go(`tickets?notification=${NOTIFICATION}`)

			await vi.waitFor(() =>
				expect(notificationStore.markRead).toHaveBeenCalledWith(NOTIFICATION),
			)
			expect(displayedRoute()).toBe('tickets-route')
			expect(window.location.search).toBe('')
		})

		it('shows the page without waiting for the marking to finish', async () => {
			await renderSignedIn(true)
			notificationStore.markRead.mockReturnValue(new Promise(() => {}))

			await go(`tickets?notification=${NOTIFICATION}`)

			expect(displayedRoute()).toBe('tickets-route')
		})

		it('leaves it unread for a guest, and removes the parameter', async () => {
			await renderSignedIn(false)

			await go(`discovery?notification=${NOTIFICATION}`)

			await vi.waitFor(() => expect(window.location.search).toBe(''))
			expect(notificationStore.markRead).not.toHaveBeenCalled()
		})
	})

	describe('install banner', () => {
		const banner = () => host().querySelector('pwa-install-banner .pwa-banner')

		async function renderAt(state: ShellState): Promise<void> {
			await fixture.stop(true)
			window.history.replaceState(null, '', '/')
			fixture = await renderShell(state)
			router = fixture.container.get(IRouter)
			await go('discovery')
		}

		const getAnimations = Element.prototype.getAnimations

		beforeEach(() => {
			// The banner restarts its cue through getAnimations(), which jsdom
			// lacks.
			Element.prototype.getAnimations = () => []
		})

		afterEach(() => {
			Element.prototype.getAnimations = getAnimations
		})

		const signedIn = {
			isAuthenticated: true,
			onboarding: { isOnboarding: false, isCompleted: true },
		}

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Authenticated user has not installed the PWA"
		it('shows for a signed-in fan after onboarding', async () => {
			await renderAt(signedIn)
			expect(banner()).not.toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Guest user is not shown the banner"
		it('is not shown to a guest', async () => {
			await renderAt({
				isAuthenticated: false,
				onboarding: { isOnboarding: false, isCompleted: true },
			})
			expect(host().querySelector('pwa-install-banner')).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/pwa-install-banner "Banner not shown during onboarding"
		it('is not shown during onboarding', async () => {
			await renderAt({
				isAuthenticated: true,
				onboarding: { isOnboarding: true, isCompleted: false },
			})
			expect(host().querySelector('pwa-install-banner')).toBeNull()
		})

		it('is hidden while a post-signup surface is open and returns after', async () => {
			await renderAt(signedIn)
			const coordinator = fixture.container.get(IPromptCoordinator)

			// @spec components/infrastructure/fan/web/global/pwa-install-banner "Post-signup dialog open — banner hidden"
			coordinator.isPostSignupSurfaceOpen = true
			await tasksSettled()
			expect(host().querySelector('pwa-install-banner')).toBeNull()

			// @spec components/infrastructure/fan/web/global/pwa-install-banner "Post-signup dialog closed — banner visible"
			coordinator.isPostSignupSurfaceOpen = false
			await tasksSettled()
			expect(banner()).not.toBeNull()
		})
	})
})
