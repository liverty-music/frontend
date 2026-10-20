import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chapterOf, guideHref } from '../../../organizer/guide/guide-link'
import {
	ConsoleI18nConfiguration,
	LANGUAGE_STORAGE_KEY,
} from '../../../organizer/i18n/console-language'
import { ConsoleFormatters } from '../../../organizer/i18n/converters'
import { IBreadcrumbs } from '../../../organizer/shell/breadcrumbs'
import { IConsoleContext } from '../../../organizer/shell/console-context'
import { TopAppBar } from '../../../organizer/shell/top-app-bar/top-app-bar'
import { ConsoleIcon } from '../../../organizer/ui/console-icon/console-icon'
import { IAuthService } from '../../../shared/services/auth-service'

const SPEC = 'components/infrastructure/organizer/web/global/organizer-shell'

const EVENT = '/organizers/org-1/artists/a-1/series/s-1/events/e-1'

/** Mounts the top bar as the shell does on the screen at `path`. */
async function mount(path: string) {
	const fixture = createFixture(
		'<top-app-bar help-href.bind="helpHref"></top-app-bar>',
		class {
			public helpHref = guideHref(chapterOf(path))
		},
		[
			ConsoleI18nConfiguration,
			...ConsoleFormatters,
			ConsoleIcon,
			TopAppBar,
			Registration.instance(IAuthService, { signOut: vi.fn() }),
			Registration.instance(IBreadcrumbs, {
				parent: undefined,
				current: undefined,
			}),
			Registration.instance(IConsoleContext, {
				organizerId: 'org-1',
				organizerName: 'XX Records',
				artists: [],
				artist: undefined,
				homeHref: '/organizers/org-1',
			}),
		],
	)
	await fixture.startPromise
	await tasksSettled()
	const help = fixture.appHost.querySelector<HTMLAnchorElement>(
		'[data-testid="help"]',
	)
	if (!help) throw new Error('the help link did not render')
	return { fixture, help }
}

describe('top app bar help', () => {
	beforeEach(() => {
		localStorage.clear()
	})
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(`@spec ${SPEC} "Help on the Sales tab"`, async () => {
		localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ja')
		const { fixture, help } = await mount(`${EVENT}/ticket-sales`)

		expect(help.getAttribute('href')).toBe('/guide.html#sell')
		// A new tab: the Sales tab stays open in the console's tab.
		expect(help.getAttribute('target')).toBe('_blank')
		expect(help.getAttribute('rel')).toBe('noopener')
		expect(help.textContent?.trim()).toBe('使い方')
		expect(help.getAttribute('title')).toBe('使い方')
		// Next to the account menu, before it.
		expect(help.nextElementSibling?.classList.contains('account')).toBe(true)
		await fixture.tearDown()
	})

	it(`@spec ${SPEC} "Console in English"`, async () => {
		localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
		const { fixture, help } = await mount('/organizers/org-1/settings')

		expect(help.textContent?.trim()).toBe('Help')
		expect(help.getAttribute('title')).toBe('Help')
		// The guide has one language: the chapter address does not name one.
		expect(help.getAttribute('href')).toBe('/guide.html#business-and-payout')
		await fixture.tearDown()
	})

	it('opens each screen of the table at its chapter', async () => {
		for (const [path, chapter] of [
			['/organizers/org-1', 'home'],
			['/organizers/org-1/artists/a-1/series', 'publish'],
			['/organizers/org-1/artists/a-1/series/s-1', 'publish'],
			['/organizers/org-1/artists/a-1/series/s-1/edit', 'publish'],
			[`${EVENT}/ticket-sales/new`, 'sell'],
			[`${EVENT}/scanners`, 'reception'],
		]) {
			const { fixture, help } = await mount(path)
			expect(help.getAttribute('href'), path).toBe(`/guide.html#${chapter}`)
			await fixture.tearDown()
		}
	})
})
