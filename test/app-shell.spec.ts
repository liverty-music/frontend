import { I18N, I18nConfiguration } from '@aurelia/i18n'
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
import ja from '../src/locales/ja/translation.json'
import { documentTitle } from '../src/route-title'
import { IActionMenuService } from '../src/services/action-menu-service'
import { IAuthService } from '../src/services/auth-service'
import { IBottomSheetTracker } from '../src/services/bottom-sheet-tracker'
import { IErrorBoundaryService } from '../src/services/error-boundary-service'
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
	'../src/routes/sign-in-callback/sign-in-callback-route',
	stub('SignInCallbackRoute'),
)
vi.mock('../src/routes/timetable/timetable-route', stub('TimetableRoute'))
vi.mock('../src/routes/concert/concert-route', stub('ConcertRoute'))
vi.mock('../src/routes/discovery/discovery-route', stub('DiscoveryRoute'))
vi.mock('../src/routes/my-artists/my-artists-route', stub('MyArtistsRoute'))
vi.mock('../src/routes/settings/settings-route', stub('SettingsRoute'))
vi.mock('../src/routes/consent/consent-route', stub('ConsentRoute'))
vi.mock(
	'../src/routes/identity-verification-callback/identity-verification-callback-route',
	stub('IdentityVerificationCallbackRoute'),
)
vi.mock(
	'../src/routes/new-lottery-entry/new-lottery-entry-route',
	stub('NewLotteryEntryRoute'),
)
vi.mock(
	'../src/routes/lottery-entries/lottery-entries-route',
	stub('LotteryEntriesRoute'),
)
vi.mock('../src/routes/legal/terms-route', stub('TermsRoute'))
vi.mock('../src/routes/legal/privacy-route', stub('PrivacyRoute'))
vi.mock('../src/routes/legal/licenses-route', stub('LicensesRoute'))
vi.mock('../src/routes/tickets/tickets-route', stub('TicketsRoute'))
vi.mock('../src/routes/order/order-route', stub('OrderRoute'))
// The not-found fallback is rendered for real: its own route config carries
// its title.
vi.mock(
	'../src/routes/sign-in-help/sign-in-help-route',
	stub('SignInHelpRoute'),
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
vi.mock('../src/routes/checkout/checkout-route', stub('CheckoutRoute'))
vi.mock(
	'../src/routes/new-resale-entry/new-resale-entry-route',
	stub('NewResaleEntryRoute'),
)
vi.mock(
	'../src/routes/resale-entries/resale-entries-route',
	stub('ResaleEntriesRoute'),
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
		/** Render with the app's Japanese catalog instead of bare keys. */
		japanese?: boolean
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
		let shell: ReturnType<typeof createFixture> | undefined
		shell = createFixture(
			CustomElement.getDefinition(AppShell).template as string,
			AppShell,
			[
				// The tab title is built as in main.ts.
				RouterConfiguration.customize({
					buildTitle: (transition) =>
						documentTitle(
							transition,
							(key) => shell?.container.get(I18N).tr(key) ?? key,
						),
				}),
				// Child CEs in the shell template (error-banner, snack-bar, …)
				// resolve I18N at construction, so the real plugin is registered;
				// with no resources `t` renders the key itself.
				I18nConfiguration.customize((options) => {
					options.initOptions = state.japanese
						? {
								lng: 'ja',
								resources: { ja: { translation: ja } },
								fallbackLng: 'ja',
								interpolation: { escapeValue: false },
							}
						: {
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
	/** The tag of the route element in the viewport (a stub, or not-found). */
	const displayedRoute = () =>
		host().querySelector('au-viewport > *')?.localName
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

		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Non-fullscreen route"
		it.each(['timetable', 'about'])(
			'shows the navigation on %s',
			async (path) => {
				await go('welcome')
				await go(path)
				expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
			},
		)
	})

	describe('chrome', () => {
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Navigation hidden on Landing Page and auth callback only"
		// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Fullscreen route"
		it.each(['welcome', 'auth/callback', 'auth/passkeys-callback'])(
			'hides the header and nav bar on %s (data.chrome: false)',
			async (path) => {
				await go('discovery')
				await go(path)
				expect(host().querySelector(BOTTOM_NAV)).toBeNull()
				expect(host().querySelector(PAGE_HEADER)).toBeNull()
			},
		)

		it('opens the sign-in help screen for a guest', async () => {
			await go('sign-in-help')
			expect(displayedRoute()).toBe('sign-in-help-route')
			expect(headerTitle()).toBe('nav.signInHelp')
		})

		it('opens the email verification screen for a guest', async () => {
			await go('verify-email')
			expect(displayedRoute()).toBe('verify-email-route')
			expect(headerTitle()).toBe('nav.verifyEmail')
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

			await go('timetable')
			expect(headerTitle()).toBe('nav.timetable')
			expect(activeTabs()).toEqual(['timetable'])
		})

		// @spec components/infrastructure/fan/web/route/settings "Header reads \"Settings\" regardless of active locale"
		it('titles Settings "Settings" in Japanese, not 設定', async () => {
			await fixture.stop(true)
			fixture = await renderShell({ japanese: true })
			router = fixture.container.get(IRouter)
			await go('settings')
			expect(displayedRoute()).toBe('settings-route')
			expect(headerTitle()).toBe('Settings')
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

		// @spec components/infrastructure/fan/web/global/page-header "Routes without a page header"
		it.each([
			['about', 'About'],
			['concerts/e-1', 'Concert'],
			['consent', 'Privacy & Analytics'],
			['legal/terms', 'Terms of Service'],
			['legal/privacy', 'Privacy Policy'],
			['legal/licenses', 'OSS Licenses'],
			['verify/callback', 'Identity Verification'],
			['no-such-page', 'Page Not Found'],
		])('renders no header on %s, and titles its tab', async (path, title) => {
			await fixture.stop(true)
			fixture = await renderShell({ japanese: true })
			router = fixture.container.get(IRouter)
			await go('settings')
			await go(path)
			expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
			expect(host().querySelector(PAGE_HEADER)).toBeNull()
			expect(document.title).toBe(`${title} | Liverty Music`)
		})
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

	describe('addresses', () => {
		const path = () => window.location.pathname
		const tapTab = async (nav: string) => {
			host()
				.querySelector<HTMLAnchorElement>(`.nav-tab[data-nav="${nav}"]`)
				?.click()
			await vi.waitFor(() => expect(path()).toBe(`/${nav}`))
			await tasksSettled()
		}

		// @spec components/infrastructure/fan/web/route/timetable "The timetable's address"
		it('serves the timetable at /timetable', async () => {
			await go('settings')
			await tapTab('timetable')
			expect(displayedRoute()).toBe('timetable-route')
		})

		// @spec components/infrastructure/fan/web/route/my-artists "The screen's address"
		// @spec components/infrastructure/fan/web/route/tickets "The screen's address"
		it.each([
			['my-artists', 'my-artists-route'],
			['tickets', 'tickets-route'],
		])('serves the %s tab at its own address', async (nav, route) => {
			await go('settings')
			await tapTab(nav)
			expect(displayedRoute()).toBe(route)
		})

		it.each([
			// @spec components/infrastructure/fan/web/route/concert "The page's address"
			['concerts/e-1', 'concert-route', '/concerts/e-1'],
			// @spec components/infrastructure/fan/web/route/settings "The screen's address"
			['settings', 'settings-route', '/settings'],
			// @spec components/infrastructure/fan/web/route/delete-account "The screen's address"
			[
				'settings/delete-account',
				'delete-account-route',
				'/settings/delete-account',
			],
			// @spec components/infrastructure/fan/web/route/resale-entries "The screen's address"
			['resale-entries', 'resale-entries-route', '/resale-entries'],
			// @spec components/infrastructure/fan/web/route/welcome "The page's address"
			['', 'welcome-route', '/welcome'],
		])('opens %s as %s at %s', async (target, route, address) => {
			await go('discovery')
			await go(target)
			expect(displayedRoute()).toBe(route)
			expect(path()).toBe(address)
		})

		// @spec components/infrastructure/fan/web/route/verify-email "The screen's address"
		it("serves the verification screen at /verify-email with the link's user and code", async () => {
			await go('verify-email?user=u-1&code=c-1')
			expect(displayedRoute()).toBe('verify-email-route')
			expect(path()).toBe('/verify-email')
			const query = new URLSearchParams(window.location.search)
			expect(query.get('user')).toBe('u-1')
			expect(query.get('code')).toBe('c-1')
		})

		it.each([
			// @spec components/infrastructure/fan/web/route/timetable "The old address is gone"
			['dashboard'],
			// @spec components/infrastructure/fan/web/route/concert "The old address is gone"
			['events/e-1'],
			['passkey-recovery'],
		])('shows the not-found screen at the old address /%s', async (old) => {
			await go('discovery')
			await go(old)
			expect(displayedRoute()).toBe('not-found-route')
		})
	})

	describe('document title', () => {
		beforeEach(async () => {
			await fixture.stop(true)
			fixture = await renderShell({ japanese: true })
			router = fixture.container.get(IRouter)
		})

		// @spec components/infrastructure/fan/web/global/page-header "Japanese display keeps the English title"
		it('shows "Checkout" in the header and the tab of checkout in Japanese', async () => {
			await go('concerts/e-1/checkout?stock=s-1')
			expect(displayedRoute()).toBe('checkout-route')
			expect(headerTitle()).toBe('Checkout')
			expect(document.title).toBe('Checkout | Liverty Music')
		})

		// @spec components/infrastructure/fan/web/global/page-header "A sheet does not change the title"
		it('titles the timetable with an open concert sheet "Timetable"', async () => {
			await go('timetable?concert=c-1')
			expect(displayedRoute()).toBe('timetable-route')
			expect(document.title).toBe('Timetable | Liverty Music')
		})

		it('gives the screens with a header the same English title in the tab', async () => {
			for (const [path, title] of [
				['tickets', 'Tickets'],
				['resale-entries', 'Resale Entries'],
				['concerts/e-1/resale-entries/new?stock=s-1', 'Resale Entry'],
				[
					'concerts/e-1/lottery-entries/new?sale=t-1&stock=s-1',
					'Lottery Entry',
				],
				['concerts/e-1/lottery-entries?sale=t-1', 'Lottery Entries'],
				['sign-in-help', "Can't Sign In"],
			]) {
				await go(path)
				expect(headerTitle()).toBe(title)
				expect(document.title).toBe(`${title} | Liverty Music`)
			}
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
		const fab = () => host().querySelector('action-menu')
		const itemIds = () =>
			fixture.container.get(IActionMenuService).actions.map((a) => a.id)

		// @spec components/infrastructure/fan/web/global/action-menu "Settings is the only item on Tickets"
		it('ends the launcher with Settings on every tab page, so Tickets shows the FAB', async () => {
			for (const tab of ['timetable', 'discovery', 'my-artists', 'tickets']) {
				await go(tab)
				expect(itemIds().at(-1)).toBe('settings')
			}
			// Tickets contributes no action of its own.
			expect(itemIds()).toEqual(['settings'])
			expect(fab()).not.toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/action-menu "No Settings item outside the tabs"
		it.each(['settings', 'events/event-1', 'orders/order-1'])(
			'offers no Settings item on %s',
			async (path) => {
				await go('timetable')
				expect(itemIds()).toContain('settings')
				await go(path)
				expect(itemIds()).not.toContain('settings')
				// @spec components/infrastructure/fan/web/global/action-menu "action menu hidden when no actions are contributed"
				expect(fab()).toBeNull()
			},
		)

		// @spec components/infrastructure/fan/web/global/action-menu "Choosing Settings"
		it('displays Settings when the Settings item is chosen', async () => {
			await go('tickets')
			const item = fixture.container
				.get(IActionMenuService)
				.actions.find((a) => a.id === 'settings')
			item?.invoke()
			await new Promise((r) => setTimeout(r, 0))
			await tasksSettled()
			expect(displayedRoute()).toBe('settings-route')
		})

		// @spec components/infrastructure/fan/web/global/action-menu "action menu hidden while a bottom sheet is open"
		it('is not shown while any bottom sheet is open and returns when it closes', async () => {
			await go('discovery')
			const dispose = fixture.container.get(IActionMenuService).register({}, [
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

		it('marks it read when the open window is brought to the front', async () => {
			const serviceWorker = new EventTarget()
			Object.defineProperty(navigator, 'serviceWorker', {
				value: serviceWorker,
				configurable: true,
			})
			try {
				await renderSignedIn(true)
				await go('tickets')

				serviceWorker.dispatchEvent(
					new MessageEvent('message', {
						data: {
							type: 'notification-opened',
							notificationId: NOTIFICATION,
						},
					}),
				)

				await vi.waitFor(() =>
					expect(notificationStore.markRead).toHaveBeenCalledWith(NOTIFICATION),
				)
				expect(displayedRoute()).toBe('tickets-route')
			} finally {
				await fixture.stop(true)
				Reflect.deleteProperty(navigator, 'serviceWorker')
				fixture = await renderShell()
				router = fixture.container.get(IRouter)
			}
		})

		it('leaves it unread for a guest, and removes the parameter', async () => {
			await renderSignedIn(false)

			await go(`discovery?notification=${NOTIFICATION}`)

			await vi.waitFor(() => expect(window.location.search).toBe(''))
			expect(notificationStore.markRead).not.toHaveBeenCalled()
		})
	})

	describe('install banner', () => {
		const banner = () =>
			host().querySelector('pwa-install-banner .bottom-banner')

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
			// It stays in the DOM, hidden and inert, so it can slide out.
			expect(banner()?.hasAttribute('hidden')).toBe(true)
			// jsdom does not reflect `inert` to an attribute; read the property.
			expect((banner() as HTMLElement).inert).toBe(true)

			// @spec components/infrastructure/fan/web/global/pwa-install-banner "Post-signup dialog closed — banner visible"
			coordinator.isPostSignupSurfaceOpen = false
			await tasksSettled()
			expect(banner()?.hasAttribute('hidden')).toBe(false)
		})
	})
})
