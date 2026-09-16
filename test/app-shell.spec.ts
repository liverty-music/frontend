import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter, IRouterEvents } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app-shell'
import { IAuthService } from '../src/services/auth-service'
import { IErrorBoundaryService } from '../src/services/error-boundary-service'
import { IOnboardingService } from '../src/services/onboarding-service'
import { IPageHeaderState } from '../src/services/page-header-state'
import { IPwaInstallService } from '../src/services/pwa-install-service'

// Mock dynamic imports used by the @route decorator on AppShell.
// Route modules are mocked to prevent vitest from loading the full
// component dependency tree (template convention → child CEs → resolve(INode)).
vi.mock('../src/routes/welcome/welcome-route', () => ({
	WelcomeRoute: class WelcomeRoute {},
}))
vi.mock('../src/routes/about/about-route', () => ({
	AboutRoute: class AboutRoute {},
}))
vi.mock('../src/routes/auth-callback/auth-callback-route', () => ({
	AuthCallbackRoute: class AuthCallbackRoute {},
}))
vi.mock('../src/routes/dashboard/dashboard-route', () => ({
	DashboardRoute: class DashboardRoute {},
}))
vi.mock('../src/routes/discovery/discovery-route', () => ({
	DiscoveryRoute: class DiscoveryRoute {},
}))
vi.mock('../src/routes/my-artists/my-artists-route', () => ({
	MyArtistsRoute: class MyArtistsRoute {},
}))
vi.mock('../src/routes/settings/settings-route', () => ({
	SettingsRoute: class SettingsRoute {},
}))
vi.mock('../src/routes/consent/consent-route', () => ({
	ConsentRoute: class ConsentRoute {},
}))
vi.mock('../src/routes/verify-callback/verify-callback-route', () => ({
	VerifyCallbackRoute: class VerifyCallbackRoute {},
}))
vi.mock('../src/routes/lottery-apply/lottery-apply-route', () => ({
	LotteryApplyRoute: class LotteryApplyRoute {},
}))
vi.mock('../src/routes/lottery-application/lottery-application-route', () => ({
	LotteryApplicationRoute: class LotteryApplicationRoute {},
}))
vi.mock('../src/routes/legal/terms-route', () => ({
	TermsRoute: class TermsRoute {},
}))
vi.mock('../src/routes/legal/privacy-route', () => ({
	PrivacyRoute: class PrivacyRoute {},
}))
vi.mock('../src/routes/legal/licenses-route', () => ({
	LicensesRoute: class LicensesRoute {},
}))
vi.mock('../src/routes/tickets/tickets-route', () => ({
	TicketsRoute: class TicketsRoute {},
}))
vi.mock('../src/routes/order/order-route', () => ({
	OrderRoute: class OrderRoute {},
}))
vi.mock('../src/routes/not-found/not-found-route', () => ({
	NotFoundRoute: class NotFoundRoute {},
}))

describe('app-shell', () => {
	/**
	 * Renders the real AppShell template through Aurelia. These are the
	 * assertions an Aurelia upgrade would most plausibly break — template
	 * compilation, `if.bind` evaluation and viewport registration — and
	 * Aurelia automerge is gated on them (OpenSpec change
	 * `automate-dependency-updates`, design D17). Do not re-skip.
	 */
	describe('shell rendering', () => {
		async function renderShell() {
			const { createFixture } = await import('@aurelia/testing')
			const fixture = createFixture('<app-shell></app-shell>', {}, [
				AppShell,
				// Child CEs in the shell template (error-banner, snack-bar, …)
				// resolve I18N at construction, so the real plugin must be
				// registered for the shell to hydrate at all.
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'en',
						resources: { en: { translation: {} } },
						fallbackLng: 'en',
						interpolation: { escapeValue: false },
					}
				}),
				IPageHeaderState,
				Registration.instance(IRouter, {
					get routeTree() {
						return { root: { children: [] } }
					},
				} as unknown as IRouter),
				Registration.instance(IRouterEvents, {
					subscribe: vi.fn(() => ({ dispose: vi.fn() })),
				}),
				Registration.instance(IErrorBoundaryService, {
					captureError: vi.fn(),
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
				Registration.instance(IPwaInstallService, { canShowFab: false }),
			])
			await fixture.started
			return fixture
		}

		it('renders the routing viewport', async () => {
			const fixture = await renderShell()
			expect(fixture.appHost.querySelector('au-viewport')).not.toBeNull()
			await fixture.stop(true)
		})

		it('renders the navigation bar when showNav is true', async () => {
			const fixture = await renderShell()
			expect(fixture.appHost.querySelector('bottom-nav-bar')).not.toBeNull()
			await fixture.stop(true)
		})
	})

	describe('router wiring', () => {
		type EventHandler = (event?: unknown) => void
		let handlers: Map<string, EventHandler>
		let mockRouteTree: {
			root: {
				children: Array<{
					data: Record<string, unknown>
					path?: string
					computeAbsolutePath?: () => string
				}>
			}
		}
		let container: ReturnType<typeof DI.createContainer>
		let sut: AppShell
		let pageHeader: IPageHeaderState

		/** Fire navigation-end with the given resolved route node. */
		function simulateNavigation(
			data?: Record<string, unknown>,
			absolutePath = '',
		) {
			mockRouteTree.root.children = [
				{ data: data ?? {}, computeAbsolutePath: () => absolutePath },
			]
			handlers.get('au:router:navigation-end')?.()
		}

		/** Fire navigation-start with a target path (via the instruction tree). */
		function simulateNavigationStart(targetPath: string) {
			handlers.get('au:router:navigation-start')?.({
				instructions: { toPath: () => targetPath },
			})
		}

		beforeEach(() => {
			handlers = new Map()
			mockRouteTree = { root: { children: [] } }
			container = DI.createContainer()
			container.register(
				IPageHeaderState,
				Registration.instance(IRouter, {
					get routeTree() {
						return mockRouteTree
					},
				} as unknown as IRouter),
				Registration.instance(IRouterEvents, {
					subscribe: vi.fn((event: string, handler: EventHandler) => {
						handlers.set(event, handler)
						return { dispose: vi.fn() }
					}),
				}),
				Registration.instance(IErrorBoundaryService, {
					captureError: vi.fn(),
					addBreadcrumb: vi.fn(),
				}),
				Registration.instance(IAuthService, {
					isAuthenticated: false,
				}),
				Registration.instance(IOnboardingService, {
					isOnboarding: false,
					isCompleted: false,
					currentStep: 'lp',
					spotlightActive: false,
					spotlightTarget: '',
					spotlightMessage: '',
					spotlightRadius: '12px',
				}),
				// AppShell eagerly resolves IPwaInstallService in its class body
				// (to register the `beforeinstallprompt` listener before routing).
				// Register a stub so DI does not jit-construct the real service,
				// whose constructor reads `window.matchMedia` (absent in jsdom).
				Registration.instance(IPwaInstallService, {
					canShowFab: false,
				}),
			)
			container.register(AppShell)
			sut = container.get(AppShell)
			pageHeader = container.get(IPageHeaderState)
			sut.binding()
		})

		describe('showNav', () => {
			it('defaults to true before first navigation', () => {
				expect(sut.showNav).toBe(true)
			})

			it('returns false for routes with nav: false (welcome, auth/callback)', () => {
				simulateNavigation({ auth: false, nav: false })
				expect(sut.showNav).toBe(false)
			})

			it('returns true when nav is not set (discovery, dashboard, etc.)', () => {
				simulateNavigation({ auth: false })
				expect(sut.showNav).toBe(true)
			})

			it('returns true when nav is explicitly true', () => {
				simulateNavigation({ nav: true })
				expect(sut.showNav).toBe(true)
			})

			it('returns true for routes with no data', () => {
				simulateNavigation()
				expect(sut.showNav).toBe(true)
			})

			it('toggles correctly across navigations', () => {
				simulateNavigation({ nav: false })
				expect(sut.showNav).toBe(false)
				simulateNavigation({ auth: false })
				expect(sut.showNav).toBe(true)
			})
		})

		describe('page identity', () => {
			it('sets the state optimistically on navigation-start', () => {
				simulateNavigationStart('settings')
				expect(pageHeader.titleKey).toBe('nav.settings')
				expect(pageHeader.activePath).toBe('settings')
			})

			it('resolves the dashboard identity (with morph) from a concerts sub-path', () => {
				simulateNavigationStart('concerts/abc-123')
				expect(pageHeader.titleKey).toBe('nav.home')
				expect(pageHeader.morphTitle).toBe(true)
				expect(pageHeader.activePath).toBe('concerts/abc-123')
			})

			it('leaves the title empty for a header-less route', () => {
				simulateNavigationStart('legal/terms')
				expect(pageHeader.titleKey).toBe('')
				expect(pageHeader.activePath).toBe('legal/terms')
			})

			it('reconciles the state authoritatively on navigation-end', () => {
				// Optimistic guess is overridden by the resolved route node.
				simulateNavigationStart('discovery')
				simulateNavigation(
					{ titleKey: 'nav.myArtists', nav: true },
					'my-artists',
				)
				expect(pageHeader.titleKey).toBe('nav.myArtists')
				expect(pageHeader.activePath).toBe('my-artists')
			})

			it('rolls back to the last confirmed identity on navigation-error', () => {
				// Confirm my-artists, then a failing navigation to settings.
				simulateNavigation({ titleKey: 'nav.myArtists' }, 'my-artists')
				simulateNavigationStart('settings')
				expect(pageHeader.titleKey).toBe('nav.settings')

				handlers.get('au:router:navigation-error')?.({ error: new Error('x') })
				expect(pageHeader.titleKey).toBe('nav.myArtists')
				expect(pageHeader.activePath).toBe('my-artists')
			})
		})
	})
})
