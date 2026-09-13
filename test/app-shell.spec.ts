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
	// TODO: Fix landing page test - requires complex mocking of auth service and RPC client
	it.skip('should render the landing page message', async () => {
		// This test is currently skipped due to complex dependencies (AuthService, Router, RPC client)
		// The landing page component requires proper mocking of the artist service RPC client
		// which is created at module level and difficult to mock in unit tests.
		// Consider integration tests or refactoring to inject the RPC client as a dependency.
	})

	// TODO(#24): Unskip once createFixture-based integration tests are supported.
	// Requires full router bootstrapping and viewport mocking that is out of scope
	// for this unit test PR. Tracked in: https://github.com/liverty-music/frontend/issues/24
	it.skip('should have a layout with navigation and viewport', async () => {
		const { createFixture } = await import('@aurelia/testing')
		const { appHost } = await createFixture('<app-shell></app-shell>', {}, [
			AppShell,
		]).started

		const myApp = appHost.querySelector('app-shell')
		expect(myApp).not.toBeNull()

		const shadowRoot = myApp?.shadowRoot
		// AppShell might NOT be shadow DOM if it's the root component without @useShadowDOM (though defined in vite plugin)
		// Actually, the vite plugin sets defaultShadowOptions to 'open'.
		const root = shadowRoot || myApp

		expect(root?.querySelector('nav')).not.toBeNull()
		expect(root?.querySelector('au-viewport')).not.toBeNull()
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
