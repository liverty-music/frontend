import { IRouter } from '@aurelia/router'
import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MyApp } from '../src/my-app'

// Mock all dynamic imports used by the @route decorator on MyApp.
// Without these mocks, the imports resolve after Vitest tears down the jsdom
// environment, causing "document is not defined" unhandled rejections.
vi.mock('../src/welcome-page', () => ({ WelcomePage: class WelcomePage {} }))
vi.mock('../src/about-page', () => ({ AboutPage: class AboutPage {} }))
vi.mock('../src/routes/auth-callback', () => ({ AuthCallback: class AuthCallback {} }))
vi.mock('../src/routes/artist-discovery/artist-discovery-page', () => ({
	ArtistDiscoveryPage: class ArtistDiscoveryPage {},
}))
vi.mock('../src/routes/onboarding-loading/loading-sequence', () => ({
	LoadingSequence: class LoadingSequence {},
}))
vi.mock('../src/routes/dashboard', () => ({ Dashboard: class Dashboard {} }))

describe('my-app', () => {
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
		const { appHost } = await createFixture('<my-app></my-app>', {}, [MyApp])
			.started

		const myApp = appHost.querySelector('my-app')
		expect(myApp).not.toBeNull()

		const shadowRoot = myApp?.shadowRoot
		// MyApp might NOT be shadow DOM if it's the root component without @useShadowDOM (though defined in vite plugin)
		// Actually, the vite plugin sets defaultShadowOptions to 'open'.
		const root = shadowRoot || myApp

		expect(root?.querySelector('nav')).not.toBeNull()
		expect(root?.querySelector('au-viewport')).not.toBeNull()
	})

	describe('showNav', () => {
		let mockRouter: Partial<IRouter>
		let container: ReturnType<typeof DI.createContainer>
		let sut: MyApp

		beforeEach(() => {
			mockRouter = {
				activeNavigation: { path: '' },
			}
			container = DI.createContainer()
			container.register(Registration.instance(IRouter, mockRouter as IRouter))
			container.register(MyApp)
			sut = container.get(MyApp)
		})

		it('should return false for empty path (root)', () => {
			mockRouter.activeNavigation = { path: '' }
			expect(sut.showNav).toBe(false)
		})

		it('should return false for /welcome route', () => {
			mockRouter.activeNavigation = { path: '/welcome' }
			expect(sut.showNav).toBe(false)
		})

		it('should return false for welcome route without leading slash', () => {
			mockRouter.activeNavigation = { path: 'welcome' }
			expect(sut.showNav).toBe(false)
		})

		it('should return false for onboarding/discover route', () => {
			mockRouter.activeNavigation = { path: 'onboarding/discover' }
			expect(sut.showNav).toBe(false)
		})

		it('should return false for onboarding/loading route', () => {
			mockRouter.activeNavigation = { path: 'onboarding/loading' }
			expect(sut.showNav).toBe(false)
		})

		it('should return false for auth/callback route', () => {
			mockRouter.activeNavigation = { path: 'auth/callback' }
			expect(sut.showNav).toBe(false)
		})

		it('should return true for dashboard route', () => {
			mockRouter.activeNavigation = { path: 'dashboard' }
			expect(sut.showNav).toBe(true)
		})

		it('should return true for about route', () => {
			mockRouter.activeNavigation = { path: 'about' }
			expect(sut.showNav).toBe(true)
		})

		it('should return true for unknown route', () => {
			mockRouter.activeNavigation = { path: 'some/other/route' }
			expect(sut.showNav).toBe(true)
		})
	})
})
