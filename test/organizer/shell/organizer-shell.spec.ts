import { IRouterEvents } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleI18nConfiguration } from '../../../organizer/i18n/console-language'
import ja from '../../../organizer/locales/ja/translation.json'
import { OrganizerShell } from '../../../organizer/organizer-shell/organizer-shell'
import { BrandLockup } from '../../../organizer/shell/brand-lockup/brand-lockup'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { ConsoleNavigation } from '../../../organizer/shell/console-navigation/console-navigation'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'

const SPEC = 'components/infrastructure/organizer/web/global/organizer-shell'

const DEEP =
	'/organizers/org-1/artists/a-1/series/s-tour/events/e-1103/ticket-sales'

/** The shell with a router that lets the test announce where a navigation ended. */
async function mountShell() {
	const handlers = new Map<string, () => void>()
	const events = {
		subscribe: vi.fn((name: string, handler: () => void) => {
			handlers.set(name, handler)
			return { dispose: vi.fn() }
		}),
	}
	const fixture = createFixture('<div></div>', class {}, [
		ConsoleI18nConfiguration,
		Registration.instance(IRouterEvents, events),
	])
	await fixture.startPromise
	const shell = fixture.container.invoke(OrganizerShell)
	shell.binding()
	/** The router finishing a navigation to `path`. */
	const navigateTo = (path: string) => {
		window.history.pushState({}, '', path)
		handlers.get('au:router:navigation-end')?.()
	}
	return {
		fixture,
		shell,
		navigateTo,
		breadcrumbs: fixture.container.get(IBreadcrumbs),
	}
}

describe('organizer shell', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'ja'])
		vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP')
	})
	afterEach(() => {
		window.history.pushState({}, '', '/')
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Current destination on a deep page"`, async () => {
		const { fixture, shell, navigateTo } = await mountShell()
		// A member on the Sales tab of an event.
		navigateTo(DEEP)
		expect(shell.current).toBe('concerts')

		// The navigation the shell frames marks that destination.
		const nav = createFixture(
			'<console-navigation current.bind="current"></console-navigation>',
			class {
				public current = shell.current
			},
			[
				ConsoleI18nConfiguration,
				ConsoleIcon,
				ConsoleNavigation,
				Registration.instance(IConsoleContext, {
					homeHref: '/organizers/org-1',
					concertsHref: '/organizers/org-1/artists/a-1/series',
					settingsHref: '/organizers/org-1/settings',
				}),
			],
		)
		await nav.startPromise
		await tasksSettled()
		const link = (destination: string) =>
			nav.appHost.querySelector(`[data-destination="${destination}"]`)
		expect(link('concerts')?.getAttribute('aria-current')).toBe('page')
		expect(link('home')?.getAttribute('aria-current')).toBeNull()
		expect(link('settings')?.getAttribute('aria-current')).toBeNull()
		await nav.tearDown()
		shell.unbinding()
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Product name in Japanese"`, async () => {
		const { fixture, shell, navigateTo, breadcrumbs } = await mountShell()

		// The top of the frame reads Liverty Music and Organizer Console.
		const lockup = createFixture(
			'<brand-lockup href="/organizers/org-1"></brand-lockup>',
			class {},
			[ConsoleI18nConfiguration, BrandLockup],
		)
		await lockup.startPromise
		const brand = lockup.appHost.querySelector('a.brand')
		expect(brand?.getAttribute('aria-label')).toBe(
			'Liverty Music Organizer Console',
		)
		expect(brand?.textContent).toContain('Liverty Music')
		expect(brand?.textContent).toContain('Organizer Console')
		await lockup.tearDown()

		// The tab names the page first and the product after it.
		navigateTo('/organizers/org-1')
		expect(document.title).toBe('ホーム — Organizer Console')
		// A deep page names itself first.
		navigateTo(DEEP)
		breadcrumbs.set([
			{
				labelKey: 'shell.nav.concerts',
				href: '/organizers/org-1/artists/a-1/series',
			},
			{
				label: 'XX Tour 2026',
				href: '/organizers/org-1/artists/a-1/series/s-tour',
			},
			{ day: new Date('2026-11-03T18:00:00+09:00') },
		])
		shell.updateTitle()
		expect(document.title).toBe('11月3日(火) — Organizer Console')

		// No other or shortened product name in the frame's or Home's texts.
		const texts: string[] = []
		const walk = (node: unknown) => {
			if (typeof node === 'string') texts.push(node)
			else if (node && typeof node === 'object') {
				for (const value of Object.values(node)) walk(value)
			}
		}
		walk([ja.app, ja.shell, ja.home])
		for (const text of texts) {
			expect(text).not.toContain('Liverty Organizer')
			expect(text).not.toContain('主催者コンソール')
			expect(text.replaceAll('Liverty Music', '')).not.toContain('Liverty')
		}
		shell.unbinding()
		await fixture.tearDown()
	})
})
