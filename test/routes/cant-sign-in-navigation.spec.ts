import { RouterConfiguration, route } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { afterEach, describe, expect, it } from 'vitest'

import settingsHtml from '../../src/routes/settings/settings-route.html?raw'
import welcomeHtml from '../../src/routes/welcome/welcome-route.html?raw'

/** The "can't sign in" link of a route template, as written there. */
function linkFrom(html: string, testId: string): Element {
	const t = document.createElement('template')
	t.innerHTML = html
	const link = t.content.querySelector(`[data-testid="${testId}"]`)
	if (!link) throw new Error(`${testId} not found`)
	return link
}

const RecoveryStub = CustomElement.define(
	{ name: 'recovery-stub', template: '<p data-route="passkey-recovery"></p>' },
	class {},
)

/**
 * Clicks the link's real markup under the real router. That the shell's
 * `/passkey-recovery` route is public is covered in test/app-shell.spec.ts.
 */
async function clickUnderRouter(link: Element) {
	@route({
		routes: [
			{
				path: '',
				component: CustomElement.define(
					{
						name: 'start-page',
						template: link.outerHTML.replace(/\st="[^"]*"/, ''),
					},
					class {},
				),
			},
			{ path: 'passkey-recovery', component: RecoveryStub },
		],
	})
	class Root {}

	const fixture = await createFixture('<au-viewport></au-viewport>', Root, [
		RouterConfiguration,
	]).started
	await tasksSettled()
	const a = fixture.appHost.querySelector('a')
	a?.click()
	await new Promise((r) => setTimeout(r, 0))
	await tasksSettled()
	return fixture
}

describe('"Can\'t sign in" links open the recovery screen', () => {
	let stop: (() => Promise<void>) | undefined

	afterEach(async () => {
		await stop?.()
		stop = undefined
		window.history.replaceState(null, '', '/')
	})

	it('navigates from the welcome link to /passkey-recovery', async () => {
		// @spec components/infrastructure/fan/web/route/welcome "Link opens the recovery screen"
		const fixture = await clickUnderRouter(
			linkFrom(welcomeHtml, 'welcome-cant-sign-in'),
		)
		stop = () => fixture.stop(true)
		expect(
			fixture.appHost.querySelector('[data-route="passkey-recovery"]'),
		).not.toBeNull()
		expect(window.location.pathname).toBe('/passkey-recovery')
	})

	it('navigates a guest from the Settings hero link to /passkey-recovery', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Guest opens sign-in help from Settings"
		const link = linkFrom(settingsHtml, 'settings-cant-sign-in')
		// The link belongs to the guest-only hero.
		expect(link.closest('section')?.getAttribute('if.bind')).toBe(
			'!auth.isAuthenticated',
		)
		const fixture = await clickUnderRouter(link)
		stop = () => fixture.stop(true)
		expect(
			fixture.appHost.querySelector('[data-route="passkey-recovery"]'),
		).not.toBeNull()
		expect(window.location.pathname).toBe('/passkey-recovery')
	})
})
