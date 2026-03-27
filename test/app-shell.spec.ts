import { IRouter, IRouterEvents } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app-shell'
import { IAuthService } from '../src/services/auth-service'
import { IErrorBoundaryService } from '../src/services/error-boundary-service'
import { IOnboardingService } from '../src/services/onboarding-service'

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
vi.mock('../src/routes/tickets/tickets-route', () => ({
	TicketsRoute: class TicketsRoute {},
}))
vi.mock('../src/routes/settings/settings-route', () => ({
	SettingsRoute: class SettingsRoute {},
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

	describe('showNav', () => {
		let mockRouter: Record<string, unknown>
		let container: ReturnType<typeof DI.createContainer>
		let sut: AppShell

		function setCurrentPath(path: string) {
			mockRouter.routeTree = {
				root: {
					children: [{ computeAbsolutePath: () => path }],
				},
			}
		}

		beforeEach(() => {
			mockRouter = {}
			setCurrentPath('')
			container = DI.createContainer()
			container.register(
				Registration.instance(IRouter, mockRouter as IRouter),
				Registration.instance(IRouterEvents, {
					subscribe: vi.fn(() => ({ dispose: vi.fn() })),
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
			)
			container.register(AppShell)
			sut = container.get(AppShell)
		})

		it('should return false for empty path (root)', () => {
			setCurrentPath('')
			expect(sut.showNav).toBe(false)
		})

		it('should return false for welcome route', () => {
			setCurrentPath('welcome')
			expect(sut.showNav).toBe(false)
		})

		it('should return true for discovery route', () => {
			setCurrentPath('discovery')
			expect(sut.showNav).toBe(true)
		})

		it('should return false for auth/callback route', () => {
			setCurrentPath('auth/callback')
			expect(sut.showNav).toBe(false)
		})

		it('should return true for dashboard route', () => {
			setCurrentPath('dashboard')
			expect(sut.showNav).toBe(true)
		})

		it('should return true for about route', () => {
			setCurrentPath('about')
			expect(sut.showNav).toBe(true)
		})

		it('should return true for unknown route', () => {
			setCurrentPath('some/other/route')
			expect(sut.showNav).toBe(true)
		})
	})
})
