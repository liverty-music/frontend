import { createFixture } from '@aurelia/testing'
import { describe, expect, it } from 'vitest'
import { MyApp } from '../src/my-app'
import { WelcomePage } from '../src/welcome-page'

describe('my-app', () => {
	it('should render the welcome page message', async () => {
		// Note: MyApp uses a router with <au-viewport>, which might be complex to test with createFixture for sub-components
		// Let's test WelcomePage directly for content, and MyApp for structure.

		const { appHost } = await createFixture(
			'<welcome-page></welcome-page>',
			{},
			[WelcomePage],
		).started

		const welcomePage = appHost.querySelector('welcome-page')
		expect(welcomePage).not.toBeNull()

		// In Shadow DOM 'open' mode, we can access the shadowRoot
		const shadowRoot = welcomePage?.shadowRoot
		expect(shadowRoot).not.toBeNull()

		const h1 = shadowRoot?.querySelector('h1')
		expect(h1?.textContent).toContain('Welcome to Aurelia 2!')
	})

	it('should have a layout with navigation and viewport', async () => {
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
})
