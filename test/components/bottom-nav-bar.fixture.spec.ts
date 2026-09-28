import { I18nConfiguration } from '@aurelia/i18n'
import { IRouter, RouterConfiguration, route } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../../src/app-shell'
import { BottomNavBar } from '../../src/components/bottom-nav-bar/bottom-nav-bar'
import { SvgIcon } from '../../src/components/svg-icon/svg-icon'

// The app's real route table, with each lazily-imported route module replaced
// by a one-element stub so the real router can display it.
const { stub } = vi.hoisted(() => ({
	stub: (name: string) => () =>
		import('../helpers/route-stubs').then((m) => m.routeModule(name)),
}))
vi.mock('../../src/routes/welcome/welcome-route', stub('WelcomeRoute'))
vi.mock('../../src/routes/about/about-route', stub('AboutRoute'))
vi.mock(
	'../../src/routes/auth-callback/auth-callback-route',
	stub('AuthCallbackRoute'),
)
vi.mock('../../src/routes/dashboard/dashboard-route', stub('DashboardRoute'))
vi.mock('../../src/routes/discovery/discovery-route', stub('DiscoveryRoute'))
vi.mock('../../src/routes/my-artists/my-artists-route', stub('MyArtistsRoute'))
vi.mock('../../src/routes/settings/settings-route', stub('SettingsRoute'))
vi.mock('../../src/routes/consent/consent-route', stub('ConsentRoute'))
vi.mock(
	'../../src/routes/verify-callback/verify-callback-route',
	stub('VerifyCallbackRoute'),
)
vi.mock(
	'../../src/routes/lottery-apply/lottery-apply-route',
	stub('LotteryApplyRoute'),
)
vi.mock(
	'../../src/routes/lottery-application/lottery-application-route',
	stub('LotteryApplicationRoute'),
)
vi.mock('../../src/routes/legal/terms-route', stub('TermsRoute'))
vi.mock('../../src/routes/legal/privacy-route', stub('PrivacyRoute'))
vi.mock('../../src/routes/legal/licenses-route', stub('LicensesRoute'))
vi.mock('../../src/routes/tickets/tickets-route', stub('TicketsRoute'))
vi.mock('../../src/routes/order/order-route', stub('OrderRoute'))

@route({ routes })
class Root {}

describe('BottomNavBar (fixture, app route table)', () => {
	let fixture: Awaited<ReturnType<typeof render>>
	let router: IRouter

	async function render() {
		const f = createFixture(
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
		)
		await f.started
		return f
	}

	async function go(path: string): Promise<void> {
		await router.load(path)
		await tasksSettled()
	}

	const tabs = () => [...fixture.appHost.querySelectorAll('.nav-tab')]
	const activeTabs = () =>
		tabs()
			.filter((t) => t.getAttribute('data-active') === 'true')
			.map((t) => t.getAttribute('data-nav'))

	beforeEach(async () => {
		window.history.replaceState(null, '', '/')
		fixture = await render()
		router = fixture.container.get(IRouter)
		await go('discovery')
		// The tabs appear once the lazily-imported route configs resolve.
		await vi.waitFor(() => expect(tabs()).toHaveLength(5))
	})

	afterEach(async () => {
		await fixture.stop(true)
	})

	it('renders the five tab routes in route-table order', () => {
		expect(tabs().map((t) => t.getAttribute('data-nav'))).toEqual([
			'home',
			'discovery',
			'my-artists',
			'ticket',
			'settings',
		])
	})

	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Tab route displayed"
	it.each([
		['dashboard', 'home'],
		['discovery', 'discovery'],
		['my-artists', 'my-artists'],
		['tickets', 'ticket'],
		['settings', 'settings'],
	])('highlights only the tab of %s', async (path, icon) => {
		await go(path)
		expect(activeTabs()).toEqual([icon])
	})

	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Concert deep-link highlights Home"
	it('highlights Home for a concert deep-link', async () => {
		await go('concerts/abc-123')
		expect(activeTabs()).toEqual(['home'])
	})

	// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Route outside every tab"
	it.each([
		'orders/ord-1',
		'legal/terms',
		'about',
	])('highlights no tab on %s', async (path) => {
		await go('settings')
		await go(path)
		expect(tabs()).toHaveLength(5)
		expect(activeTabs()).toEqual([])
	})
})
