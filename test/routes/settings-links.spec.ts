import { IRouter, RouterConfiguration, route } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { afterEach, describe, expect, it } from 'vitest'

import { ListItem } from '../../src/components/list-item/list-item'
import settingsHtml from '../../src/routes/settings/settings-route.html?raw'

/**
 * A link of the Settings template, as written there, without its `t`: an
 * `<a>`, or a `<list-item>` row that renders one.
 */
function linkFrom(testId: string): string {
	const t = document.createElement('template')
	t.innerHTML = settingsHtml
	const link = t.content.querySelector(
		`[data-testid="${testId}"], [test-id="${testId}"]`,
	)
	if (!link) throw new Error(`${testId} not found`)
	return link.outerHTML
		.replace(/\st="[^"]*"/g, '')
		.replace(/\slabel\.bind="[^"]*"/g, '')
		.replace(/\$\{supportEmail\}/, 'support@example.com')
}

const PrivacyStub = CustomElement.define(
	{ name: 'privacy-stub', template: '<p data-route="legal-privacy"></p>' },
	class {},
)

/**
 * Clicks a Settings link's real markup under the real router, from the
 * `settings` route, the routing context the link lives in.
 */
async function clickFromSettings(link: string) {
	@route({
		routes: [
			{
				path: 'settings',
				component: CustomElement.define(
					{ name: 'settings-page', template: link, dependencies: [ListItem] },
					class {},
				),
			},
			{ path: 'legal/privacy', component: PrivacyStub },
		],
	})
	class Root {}

	const fixture = await createFixture('<au-viewport></au-viewport>', Root, [
		RouterConfiguration,
	]).started
	await fixture.container.get(IRouter).load('settings')
	await tasksSettled()
	const a = fixture.appHost.querySelector('a') as HTMLAnchorElement
	let defaultPrevented: boolean | undefined
	a.addEventListener('click', (e) => {
		// Read after every listener, the router's included, has run.
		queueMicrotask(() => {
			defaultPrevented = e.defaultPrevented
		})
	})
	a.click()
	await new Promise((r) => setTimeout(r, 0))
	await tasksSettled()
	return { fixture, defaultPrevented: () => defaultPrevented }
}

describe('Settings links under the real router', () => {
	let stop: (() => Promise<void>) | undefined

	afterEach(async () => {
		await stop?.()
		stop = undefined
		window.history.replaceState(null, '', '/')
	})

	it('leaves the Contact mailto link to the browser, so the mail app opens', async () => {
		// Only the click: the row, its label and address are checked in
		// settings-route.fixture.spec.ts ("Contact support").
		const r = await clickFromSettings(linkFrom('settings-contact'))
		stop = () => r.fixture.stop(true)
		// The router's href attribute treats a URL with a scheme as external:
		// it neither cancels the click nor navigates in the app.
		expect(r.defaultPrevented()).toBe(false)
		expect(window.location.pathname).toBe('/settings')
	})

	it('opens /legal/privacy from the consent note, resolved from the root', async () => {
		// Only the navigation: the note and the single Privacy Policy row are
		// checked in settings-route.fixture.spec.ts and the e2e test.
		const r = await clickFromSettings(
			linkFrom('settings-analytics-policy-link'),
		)
		stop = () => r.fixture.stop(true)
		expect(
			r.fixture.appHost.querySelector('[data-route="legal-privacy"]'),
		).not.toBeNull()
		expect(window.location.pathname).toBe('/legal/privacy')
	})
})
