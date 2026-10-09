import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter, RouterConfiguration } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app-shell'
import { BottomNavBar } from '../src/components/bottom-nav-bar/bottom-nav-bar'
import { PageHeader } from '../src/components/page-header/page-header'
import { SvgIcon } from '../src/components/svg-icon/svg-icon'
import { IAuthService } from '../src/services/auth-service'
import { IErrorBoundaryService } from '../src/services/error-boundary-service'
import { IOnboardingService } from '../src/services/onboarding-service'
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
	'../src/routes/lottery-apply/lottery-apply-route',
	stub('LotteryApplyRoute'),
)
vi.mock(
	'../src/routes/lottery-application/lottery-application-route',
	stub('LotteryApplicationRoute'),
)
vi.mock('../src/routes/legal/terms-route', stub('TermsRoute'))
vi.mock('../src/routes/legal/privacy-route', stub('PrivacyRoute'))
vi.mock('../src/routes/legal/licenses-route', stub('LicensesRoute'))
vi.mock('../src/routes/tickets/tickets-route', stub('TicketsRoute'))
vi.mock('../src/routes/order/order-route', stub('OrderRoute'))
vi.mock('../src/routes/not-found/not-found-route', stub('NotFoundRoute'))

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

	async function renderShell() {
		captureError = vi.fn()
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
				SvgIcon,
				Registration.instance(IErrorBoundaryService, {
					captureError,
					addBreadcrumb: vi.fn(),
				}),
				Registration.instance(IAuthService, { isAuthenticated: false }),
				Registration.instance(IOnboardingService, {
					isOnboarding: false,
					isCompleted: false,
					currentStep: 'lp',
					spotlightActive: false,
					spotlightTarget: '',
					spotlightMessage: '',
					spotlightRadius: '12px',
				}),
				// AppShell eagerly resolves IPwaInstallService; a stub keeps DI from
				// constructing the real one, which reads `window.matchMedia`.
				Registration.instance(IPwaInstallService, { canShowFab: false }),
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
		it.each(['welcome', 'auth/callback'])(
			'hides the header and nav bar on %s (data.chrome: false)',
			async (path) => {
				await go('discovery')
				await go(path)
				expect(host().querySelector(BOTTOM_NAV)).toBeNull()
				expect(host().querySelector(PAGE_HEADER)).toBeNull()
			},
		)

		it('shows the nav bar again when leaving a chrome-less route', async () => {
			await go('welcome')
			await go('settings')
			expect(host().querySelector(BOTTOM_NAV)).not.toBeNull()
		})
	})

	describe('page identity', () => {
		// @spec components/infrastructure/fan/web/global/page-header "Header title and active tab match the route shown"
		it('shows the displayed tab route’s title and highlights its tab', async () => {
			await go('settings')
			expect(headerTitle()).toBe('nav.settings')
			expect(activeTabs()).toEqual(['settings'])

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
				expect(activeTabs()).toEqual(['settings'])

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
			'router:navigation-error',
		)
	})
})
