import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter, RouterConfiguration, route } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SvgIcon } from '../svg-icon/svg-icon'
import { BottomNavBar } from './bottom-nav-bar'

const page = (name: string) =>
	CustomElement.define({ name, template: `<p>${name}</p>` }, class {})
// A lazily-imported route, as the app's route table declares them.
const lazy = (name: string) => Promise.resolve({ [name]: page(name) })

@route({
	routes: [
		{ path: '', redirectTo: 'a' },
		{
			path: ['a', 'a-detail/:id'],
			component: lazy('route-a'),
			nav: true,
			data: { icon: 'home', labelKey: 'nav.a' },
		},
		{ path: 'hidden', component: lazy('route-hidden'), nav: false },
		{
			path: 'b',
			component: page('route-b'),
			nav: true,
			data: { icon: 'settings', labelKey: 'nav.b' },
		},
	],
})
class Root {}

describe('BottomNavBar', () => {
	let fixture: Awaited<ReturnType<typeof createFixture>['started']>
	let router: IRouter

	const tabs = () => [...fixture.appHost.querySelectorAll('a.nav-tab')]

	beforeEach(async () => {
		window.history.replaceState(null, '', '/')
		fixture = await createFixture(
			'<au-viewport></au-viewport><bottom-nav-bar></bottom-nav-bar>',
			Root,
			[
				RouterConfiguration,
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng: 'en',
						resources: { en: { translation: {} } },
						fallbackLng: 'en',
					}
				}),
				BottomNavBar,
				SvgIcon,
			],
		).started
		router = fixture.container.get(IRouter)
		await vi.waitFor(() => expect(tabs()).toHaveLength(2))
	})

	afterEach(async () => {
		await fixture.stop(true)
	})

	it('renders one tab per `nav: true` route, in route order', () => {
		expect(tabs().map((t) => t.getAttribute('data-nav'))).toEqual([
			'home',
			'settings',
		])
	})

	it('links each tab to its route’s first path', () => {
		expect(
			tabs().map((t) => new URL(t.getAttribute('href') ?? '').pathname),
		).toEqual(['/a', '/b'])
	})

	it('renders the icon and label from the route data', () => {
		const [first] = tabs()
		const icon = CustomElement.for<SvgIcon>(
			first.querySelector('svg-icon') as HTMLElement,
		)
		expect(icon.viewModel.name).toBe('home')
		expect(first.querySelector('.nav-label')?.textContent).toBe('nav.a')
	})

	it('binds data-active to the router’s isActive, including a second path', async () => {
		await router.load('b')
		await tasksSettled()
		expect(tabs().map((t) => t.getAttribute('data-active'))).toEqual([
			'false',
			'true',
		])

		await router.load('a-detail/1')
		await tasksSettled()
		expect(tabs().map((t) => t.getAttribute('data-active'))).toEqual([
			'true',
			'false',
		])

		await router.load('hidden')
		await tasksSettled()
		expect(tabs().map((t) => t.getAttribute('data-active'))).toEqual([
			'false',
			'false',
		])
	})

	describe('a tab switch inside a View Transition', () => {
		const unhandled: unknown[] = []
		const onUnhandled = (reason: unknown) => unhandled.push(reason)

		// Chromium skips a transition (e.g. a failed prepaint check) by
		// rejecting `ready`; it still runs the update callback, whose promise
		// settles `updateCallbackDone` and `finished`.
		const skippingTransition = (update: () => Promise<void>) => {
			const done = update()
			return {
				ready: Promise.reject(
					new DOMException('Transition was skipped', 'InvalidStateError'),
				),
				updateCallbackDone: done,
				finished: done,
			}
		}

		const settle = () => new Promise((r) => setTimeout(r, 0))
		const original = document.startViewTransition

		beforeEach(() => {
			unhandled.length = 0
			globalThis.process.on('unhandledRejection', onUnhandled)
			Object.assign(document, { startViewTransition: skippingTransition })
		})

		afterEach(() => {
			globalThis.process.off('unhandledRejection', onUnhandled)
			Object.assign(document, { startViewTransition: original })
		})

		it('changes the route and leaves no unhandled rejection when the browser skips it', async () => {
			tabs()[1].dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true }),
			)
			await vi.waitFor(() =>
				expect(fixture.appHost.querySelector('route-b')).not.toBeNull(),
			)
			await settle()
			expect(unhandled).toEqual([])
		})

		it('leaves no unhandled rejection when the route load fails', async () => {
			vi.spyOn(router, 'load').mockRejectedValueOnce(new Error('load failed'))
			tabs()[1].dispatchEvent(
				new MouseEvent('click', { bubbles: true, cancelable: true }),
			)
			await settle()
			await settle()
			expect(router.load).toHaveBeenCalledWith('b')
			expect(unhandled).toEqual([])
		})
	})
})
