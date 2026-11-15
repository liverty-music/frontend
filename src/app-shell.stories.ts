import {
	ICurrentRoute,
	IRouteContext,
	IRouter,
	IRouterEvents,
} from '@aurelia/router'
import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import {
	CustomElement,
	IEventAggregator,
	type IRegistry,
	Registration,
} from 'aurelia'
import { expect, userEvent, waitFor } from 'storybook/test'
import { atSize } from '../.storybook/viewport'
import { Snack, type SnackSeverity } from '../shared/ui/snack-bar/snack'
import { ILocalStorage } from './adapter/storage/local-storage'
import { AppShell } from './app-shell'
import { BottomNavBar } from './components/bottom-nav-bar/bottom-nav-bar'
import { ConfirmDialog } from './components/confirm-dialog/confirm-dialog'
import { ListItem } from './components/list-item/list-item'
import { PageHeader } from './components/page-header/page-header'
import { PageHelp } from './components/page-help/page-help'
import { SettingsConsentRow } from './components/settings-consent-row/settings-consent-row'
import { SettingsStatusRow } from './components/settings-status-row/settings-status-row'
import { SettingsSwitchRow } from './components/settings-switch-row/settings-switch-row'
import { SignupPromptBanner } from './components/signup-prompt-banner/signup-prompt-banner'
import { StatePlaceholder } from './components/state-placeholder/state-placeholder'
import { UserHomeSelector } from './components/user-home-selector/user-home-selector'
import { IAppConfig } from './config/app-config'
import type { FollowedArtist } from './entities/follow'
import { IAnalyticsService } from './lib/analytics/analytics-service'
import { IConsentService } from './lib/consent/consent-service'
import { MyArtistsRoute } from './routes/my-artists/my-artists-route'
import { SettingsRoute } from './routes/settings/settings-route'
import { IAudioEngine } from './services/audio-engine'
import { IAuthService } from './services/auth-service'
import { IErrorBoundaryService } from './services/error-boundary-service'
import type { FabAction } from './services/fab-menu-service'
import { IFollowStore } from './services/follow-store'
import { IIdentityVerificationService } from './services/identity-verification-service'
import { INotificationStore } from './services/notification-store'
import { IOnboardingService } from './services/onboarding-service'
import { IPushOfferService } from './services/push-offer-service'
import { IPushService } from './services/push-service'
import { IPwaInstallService } from './services/pwa-install-service'
import { IUserStore } from './services/user-store'

// The real app shell (view model, template, app-shell.css and every element
// it renders: page header, bottom navigation bar, FAB launcher, snack bar,
// install banner) composed with the global styles, as one screen. No router
// runs: `<au-viewport>` is a stand-in element that renders the page (a plain
// one, or a real route with fake stores), and the route the shell reads is a
// fake ICurrentRoute. What needs real routing between real routes, the WebKit
// engine or the app's web font stays in the end-to-end suite.

const noop = () => {}

/** The four tab routes, as the router's navigation model gives them. */
const TABS = [
	{ id: 'dashboard', icon: 'home', labelKey: 'nav.home', active: true },
	{ id: 'discovery', icon: 'discovery', labelKey: 'nav.discovery' },
	{ id: 'my-artists', icon: 'my-artists', labelKey: 'nav.myArtists' },
	{ id: 'tickets', icon: 'ticket', labelKey: 'nav.tickets' },
].map((t) => ({
	id: t.id,
	path: [t.id],
	isActive: !!t.active,
	data: { icon: t.icon, labelKey: t.labelKey },
}))

/** The dashboard's own launcher actions; the shell adds Settings after them. */
const DASHBOARD_ACTIONS: FabAction[] = [
	{
		id: 'beam',
		labelKey: 'fabMenu.beam',
		icon: 'spotlight',
		kind: 'toggle',
		isOn: () => false,
		invoke: noop,
	},
	{
		id: 'filter',
		labelKey: 'fabMenu.filter',
		icon: 'filter',
		kind: 'command',
		invoke: noop,
	},
	{
		id: 'help',
		labelKey: 'fabMenu.help',
		icon: 'help-circle',
		kind: 'command',
		invoke: noop,
	},
]

/** A plain page that fills the route area and scrolls. */
const PLAIN_PAGE =
	'<section data-route style="block-size: 100%; overflow: auto"><p>Page</p></section>'

interface ShellOptions {
	/** The page inside `<au-viewport>`. */
	page?: string
	/** Elements the page uses. */
	pageRegister?: IRegistry[]
	/** Fakes the page's route resolves, merged over the shell's. */
	pageItems?: Record<string, [unknown, object]>
	/** The displayed route is a tab page (the launcher ends with Settings). */
	tab?: boolean
	/** The route's i18n title key. */
	titleKey?: string
	signedIn?: boolean
	/** The install banner is offered (the app is not installed). */
	installBanner?: boolean
}

/** The install service the banner reads; confirming the install hides it. */
function installService(offered: boolean) {
	return {
		isIos: false,
		canShowFab: false,
		shouldShowInstallBanner: offered,
		install: async () => {},
		confirmInstalled(this: { shouldShowInstallBanner: boolean }) {
			this.shouldShowInstallBanner = false
		},
	}
}

function shell({
	page = PLAIN_PAGE,
	pageRegister = [],
	pageItems = {},
	tab = true,
	titleKey = 'nav.home',
	signedIn = true,
	installBanner = false,
}: ShellOptions = {}) {
	const viewport = CustomElement.define({
		name: 'au-viewport',
		template: page,
	})
	const fakes: Record<string, [unknown, object]> = {
		router: [IRouter, { routeTree: null, load: async () => true }],
		routerEvents: [IRouterEvents, { subscribe: () => ({ dispose: noop }) }],
		routeContext: [
			IRouteContext,
			{
				routeConfigContext: {
					navigationModel: { resolve: () => undefined, routes: TABS },
				},
			},
		],
		currentRoute: [
			ICurrentRoute,
			{ parameterInformation: [{ config: { nav: tab, data: { titleKey } } }] },
		],
		auth: [
			IAuthService,
			{ isAuthenticated: signedIn, ready: Promise.resolve() },
		],
		onboarding: [
			IOnboardingService,
			{ isOnboarding: false, isCompleted: true },
		],
		notifications: [
			INotificationStore,
			{ unreadCount: 0, refresh: async () => {}, markRead: async () => {} },
		],
		pwaInstall: [IPwaInstallService, installService(installBanner)],
		analytics: [IAnalyticsService, { capture: noop }],
		errorBoundary: [
			IErrorBoundaryService,
			{ captureError: noop, addBreadcrumb: noop, currentError: null },
		],
	}
	for (const [key, [token, value]] of Object.entries(pageItems)) {
		const base = fakes[key]?.[1] ?? {}
		fakes[key] = [token, Object.assign(base, value)]
	}
	return defineAureliaStory({
		template: '<app-shell></app-shell>',
		register: [AppShell, BottomNavBar, PageHeader, viewport, ...pageRegister],
		items: Object.values(fakes).map(([token, value]) =>
			Registration.instance(token as never, value),
		),
	})
}

const meta = {
	title: 'App/AppShell',
	component: AppShell,
	parameters: {
		layout: 'fullscreen',
		a11y: {
			config: {
				rules: [
					// The route area is a scroll container reached by keyboard
					// through the controls inside it.
					{ id: 'scrollable-region-focusable', enabled: false },
					// Known defect (fab-menu.stories.ts): the open panel is a
					// `dialog` given `role="group"`.
					{ id: 'aria-allowed-role', enabled: false },
				],
			},
		},
	},
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

// ---- reading the screen -------------------------------------------------

const box = (el: Element) => el.getBoundingClientRect()
const centre = (r: DOMRect) => ({
	x: r.left + r.width / 2,
	y: r.top + r.height / 2,
})
const intersects = (a: DOMRect, b: DOMRect) =>
	a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

function one<T extends Element = HTMLElement>(
	root: HTMLElement,
	selector: string,
): T {
	const el = root.querySelector<T>(selector)
	if (!el) throw new Error(`${selector} not rendered`)
	return el
}

const shellOf = (root: HTMLElement) => one(root, 'app-shell')
const nav = (root: HTMLElement) => one(root, 'bottom-nav-bar nav')
const fab = (root: HTMLElement) =>
	one<HTMLButtonElement>(root, 'fab-menu .fab-toggle')
const banner = (root: HTMLElement) =>
	one(root, 'pwa-install-banner .bottom-banner')

/** The shell's view model and its container. */
function shellParts(root: HTMLElement) {
	const controller = CustomElement.for<AppShell>(shellOf(root))
	return { vm: controller.viewModel, container: controller.container }
}

/** A CSS length resolved to px. */
function px(root: HTMLElement, length: string): number {
	const probe = document.createElement('div')
	probe.style.blockSize = length
	probe.style.position = 'absolute'
	root.append(probe)
	const h = probe.getBoundingClientRect().height
	probe.remove()
	return h
}

/** Every finite animation under `el` has ended (the banner's cue aside). */
async function settled(el: Element): Promise<void> {
	await waitFor(
		() => {
			const running = el
				.getAnimations({ subtree: true })
				.filter(
					(a) =>
						a.effect?.getTiming().iterations !== Infinity &&
						(a as CSSAnimation).animationName !== 'banner-cue' &&
						a.playState === 'running',
				)
			if (running.length) throw new Error('still moving')
		},
		{ timeout: 5000 },
	)
}

/** The shell is on screen with its tabs and, when one shows, the FAB at rest. */
async function shown(root: HTMLElement, { withFab = true } = {}) {
	await waitFor(() => expect(root.querySelectorAll('.nav-tab')).toHaveLength(4))
	if (withFab) {
		await waitFor(() => fab(root))
		await settled(one(root, 'fab-menu'))
	}
}

/** The route contributes the dashboard's actions to the launcher. */
function contributeDashboardActions(root: HTMLElement): void {
	shellParts(root).vm.fabMenu.register({}, DASHBOARD_ACTIONS)
}

/** Publish a snack on the app's event aggregator; resolves once it is at rest. */
async function openSnack(
	root: HTMLElement,
	severity: SnackSeverity = 'info',
): Promise<Snack> {
	const snack = new Snack('Saved', severity, {
		duration: Number.POSITIVE_INFINITY,
	})
	shellParts(root).container.get(IEventAggregator).publish(snack)
	const item = await waitFor(() => one(root, '.snack-item:popover-open'))
	await settled(item)
	await settled(one(root, 'fab-menu'))
	return snack
}

/** Dismiss a snack and wait until it has left. */
async function closeSnack(root: HTMLElement, snack: Snack): Promise<void> {
	snack.handle?.dismiss()
	await waitFor(
		() => expect(root.querySelectorAll('.snack-item')).toHaveLength(0),
		{ timeout: 5000 },
	)
	await settled(one(root, 'fab-menu'))
}

async function openArc(root: HTMLElement): Promise<void> {
	await userEvent.click(fab(root))
	await waitFor(() =>
		expect(fab(root).getAttribute('aria-expanded')).toBe('true'),
	)
	await settled(one(root, 'fab-menu'))
}

async function closeArc(root: HTMLElement): Promise<void> {
	await userEvent.click(fab(root))
	await waitFor(() =>
		expect(fab(root).getAttribute('aria-expanded')).toBe('false'),
	)
	await settled(one(root, 'fab-menu'))
}

/** The open arc's items, each one higher than the FAB. */
async function expectArcAboveFab(root: HTMLElement, count: number) {
	const items = [...root.querySelectorAll('fab-menu .fab-item')]
	await expect(items).toHaveLength(count)
	const f = centre(box(fab(root)))
	for (const item of items) {
		await expect(centre(box(item)).y).toBeLessThan(f.y)
	}
}

/** Raised: 56 px across, its centre on the bar's top edge. */
async function expectRaised(root: HTMLElement) {
	const f = box(fab(root))
	await expect(Math.round(f.width)).toBe(56)
	await expect(Math.abs(centre(f).y - box(nav(root)).top)).toBeLessThan(1)
}

/** Sunk: 40 px across, centred, entirely within the bar's height. */
async function expectSunk(root: HTMLElement): Promise<DOMRect> {
	const f = box(fab(root))
	const bar = box(nav(root))
	await expect(Math.round(f.width)).toBe(40)
	await expect(Math.round(f.height)).toBe(40)
	await expect(Math.abs(centre(f).x - innerWidth / 2)).toBeLessThan(1)
	await expect(f.top).toBeGreaterThanOrEqual(bar.top - 0.5)
	await expect(f.bottom).toBeLessThanOrEqual(bar.bottom + 0.5)
	return f
}

/** The bottom edge of the area routes render in (the viewport's content box). */
function routeAreaBottom(root: HTMLElement): number {
	const viewport = one(root, 'au-viewport')
	return (
		box(viewport).bottom -
		Number.parseFloat(getComputedStyle(viewport).paddingBottom)
	)
}

/**
 * What a tap at the centre of `el` reaches: `el` itself, or the element in
 * the way (named for the failure message).
 */
function tapAt(el: Element): string {
	const c = centre(box(el))
	const hit = document.elementFromPoint(c.x, c.y)
	if (hit != null && (hit === el || el.contains(hit))) return 'target'
	return hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : 'nothing'
}

// ---- stories --------------------------------------------------------------

/**
 * A tab page with the dashboard's actions and no banner: the shell's grid,
 * the four tabs around the centre slot, the FAB in the notch, and the route
 * area ending at the bar. No URL change: the shell runs without a router.
 */
export const TabPage = {
	render: () => shell(),
	play: async ({ canvasElement }) => {
		const url = location.href
		contributeDashboardActions(canvasElement)
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			const root = shellOf(canvasElement)

			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "App shell uses CSS Grid layout with named areas"
			const grid = getComputedStyle(root)
			await expect(grid.display).toBe('grid')
			await expect(grid.gridTemplateAreas).toBe('"header" "viewport" "nav"')
			await expect(box(root).height).toBe(innerHeight)
			const viewport = one(canvasElement, 'au-viewport')
			await expect(viewport.parentElement).toBe(root)
			await expect(getComputedStyle(viewport).gridArea).toContain('viewport')
			await expect(
				getComputedStyle(one(canvasElement, 'page-header')).gridArea,
			).toContain('header')
			const host = one(canvasElement, 'bottom-nav-bar')
			await expect(getComputedStyle(host).gridArea).toContain('nav')
			for (const el of [host, nav(canvasElement)]) {
				await expect(['fixed', 'absolute']).not.toContain(
					getComputedStyle(el).position,
				)
			}
			await expect(nav(canvasElement).hasAttribute('popover')).toBe(false)
			await expect(box(nav(canvasElement)).bottom).toBe(innerHeight)

			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Navigation shown on post-onboarding routes"
			const tabs = [...canvasElement.querySelectorAll('.nav-tab')]
			await expect(tabs.map((t) => t.getAttribute('data-nav'))).toEqual([
				'home',
				'discovery',
				'my-artists',
				'ticket',
			])
			// Two tabs on each side of an empty centre slot wider than the FAB.
			await expect(
				box(tabs[2]).left - box(tabs[1]).right,
			).toBeGreaterThanOrEqual(56)

			// @spec components/infrastructure/fan/web/global/fab-menu "FAB floats in the thumb zone above content"
			const f = box(fab(canvasElement))
			await expect(Math.abs(centre(f).x - innerWidth / 2)).toBeLessThan(1)
			await expectRaised(canvasElement)
			const notchRadius = px(canvasElement, 'var(--fab-notch-radius)')
			await expect(notchRadius - f.width / 2).toBeGreaterThanOrEqual(6)
			await expect(nav(canvasElement).dataset.notch).toBe('true')
			for (const tab of tabs) {
				for (const part of tab.querySelectorAll('.nav-icon, .nav-label')) {
					await expect(intersects(box(part), f)).toBe(false)
				}
			}

			// @spec components/infrastructure/fan/web/global/app-shell "No banner, no reserved space"
			const navTop = box(nav(canvasElement)).top
			await expect(
				Math.abs(routeAreaBottom(canvasElement) - navTop),
			).toBeLessThan(1)
			await expect(Math.abs(box(viewport).bottom - navTop)).toBeLessThan(1)
		})
		await expect(location.href).toBe(url)
	},
} satisfies Story

/**
 * Tickets: a tab page that contributes no action of its own. The launcher
 * still shows, with Settings alone, and the bar cuts its notch around it.
 */
export const TabPageWithoutActions = {
	render: () => shell({ titleKey: 'nav.tickets' }),
	play: async ({ canvasElement }) => {
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Tickets shows the FAB"
			await expect(fab(canvasElement).checkVisibility()).toBe(true)
			await expect(
				shellParts(canvasElement).vm.fabMenu.actions.map((a) => a.id),
			).toEqual(['settings'])
			await expect(nav(canvasElement).dataset.notch).toBe('true')
			await expect(getComputedStyle(nav(canvasElement)).maskImage).toContain(
				'radial-gradient',
			)
		})
	},
} satisfies Story

/**
 * A snack bar opens with no banner: the FAB sinks into the bar, the snack sits
 * one space-s step above the bar whatever its severity, the sunk FAB still
 * opens the arc, and the FAB rises again when the last snack closes.
 */
export const SnackSinksTheFab = {
	render: () => shell(),
	play: async ({ canvasElement }) => {
		contributeDashboardActions(canvasElement)
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			await expectRaised(canvasElement)
			const spaceS = px(canvasElement, 'var(--space-s)')

			const first = await openSnack(canvasElement)
			// @spec components/infrastructure/fan/web/global/fab-menu "A snack bar opens"
			const f = await expectSunk(canvasElement)
			const snack = box(one(canvasElement, '.snack-item'))
			await expect(intersects(f, snack)).toBe(false)
			// @spec components/infrastructure/fan/web/global/snack-bar "No banner is visible"
			const gap = box(nav(canvasElement)).top - snack.bottom
			await expect(Math.abs(gap - spaceS)).toBeLessThan(1)
			await expect(gap).toBeGreaterThanOrEqual(16)
			await expect(gap).toBeLessThanOrEqual(20)

			// @spec components/infrastructure/fan/web/global/fab-menu "The sunk FAB still opens the actions"
			await openArc(canvasElement)
			await expectArcAboveFab(canvasElement, 4)
			await closeArc(canvasElement)

			// @spec components/infrastructure/fan/web/global/fab-menu "The last snack bar closes"
			await closeSnack(canvasElement, first)
			await expectRaised(canvasElement)

			// @spec components/infrastructure/fan/web/global/snack-bar "Same placement for every severity"
			const bottoms: number[] = []
			for (const severity of ['info', 'warning', 'error'] as const) {
				const snack = await openSnack(canvasElement, severity)
				bottoms.push(box(one(canvasElement, '.snack-item')).bottom)
				await closeSnack(canvasElement, snack)
			}
			await expect(Math.abs(bottoms[1] - bottoms[0])).toBeLessThan(1)
			await expect(Math.abs(bottoms[2] - bottoms[0])).toBeLessThan(1)
		})
	},
} satisfies Story

/**
 * A signed-in fan who has not installed the app sees the install banner: the
 * FAB rests sunk with the notch kept, the route area ends at the banner, the
 * arc still opens, a snack sits above the banner (also with the hidden signup
 * prompt mounted beside it), and confirming the install brings the FAB back.
 */
export const BannerSinksTheFab = {
	render: () =>
		shell({
			installBanner: true,
			page: `${PLAIN_PAGE}<signup-prompt-banner visible.bind="false"></signup-prompt-banner>`,
			pageRegister: [SignupPromptBanner],
		}),
	play: async ({ canvasElement }) => {
		contributeDashboardActions(canvasElement)
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			await settled(one(canvasElement, 'pwa-install-banner'))
			const b = box(banner(canvasElement))

			// @spec components/infrastructure/fan/web/global/fab-menu "A bottom banner is visible"
			const f = await expectSunk(canvasElement)
			await expect(intersects(f, b)).toBe(false)
			await expect(f.top).toBeGreaterThanOrEqual(b.bottom - 0.5)
			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "FAB sunk under a banner"
			await expect(nav(canvasElement).dataset.notch).toBe('true')
			const radius = px(canvasElement, 'var(--fab-notch-radius)')
			await expect(getComputedStyle(nav(canvasElement)).maskImage).toContain(
				`${radius}px at`,
			)
			await expect(
				Math.abs(routeAreaBottom(canvasElement) - b.top),
			).toBeLessThan(1)

			// @spec components/infrastructure/fan/web/global/fab-menu "The sunk FAB still opens the actions"
			await openArc(canvasElement)
			await expectArcAboveFab(canvasElement, 4)
			await closeArc(canvasElement)

			// @spec components/infrastructure/fan/web/global/fab-menu "A snack bar opens above a bottom banner"
			// @spec components/infrastructure/fan/web/global/snack-bar "A banner is visible"
			// @spec components/infrastructure/fan/web/global/snack-bar "The FAB stays sunk under a banner and a snack bar"
			await expect(
				canvasElement.querySelector('signup-prompt-banner'),
			).not.toBeNull()
			const above = await openSnack(canvasElement)
			const sunk = await expectSunk(canvasElement)
			const snack = box(one(canvasElement, '.snack-item'))
			const gap = box(banner(canvasElement)).top - snack.bottom
			await expect(
				Math.abs(gap - px(canvasElement, 'var(--space-s)')),
			).toBeLessThan(1)
			await expect(gap).toBeGreaterThan(0)
			await expect(intersects(sunk, snack)).toBe(false)
			await expect(intersects(snack, box(banner(canvasElement)))).toBe(false)
			await closeSnack(canvasElement, above)

			// @spec components/infrastructure/fan/web/global/fab-menu "The bottom banner goes away"
			await userEvent.click(
				one(canvasElement, '[data-testid="pwa-install-banner-cta"]'),
			)
			await userEvent.click(
				await waitFor(() =>
					one(canvasElement, '[data-testid="pwa-install-banner-confirm"]'),
				),
			)
			await waitFor(() =>
				expect(
					canvasElement.querySelectorAll('pwa-install-banner .bottom-banner'),
				).toHaveLength(0),
			)
			await waitFor(() => fab(canvasElement))
			await settled(one(canvasElement, 'fab-menu'))
			await expectRaised(canvasElement)
		})
	},
} satisfies Story

/**
 * The app is installed and the page mounts the signup prompt's host too, both
 * banners hidden: neither adds height, so a snack sits above the bar.
 */
export const HiddenBannersAddNoHeight = {
	render: () =>
		shell({
			page: `${PLAIN_PAGE}<signup-prompt-banner visible.bind="false"></signup-prompt-banner>`,
			pageRegister: [SignupPromptBanner],
		}),
	play: async ({ canvasElement }) => {
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			// @spec components/infrastructure/fan/web/global/snack-bar "A hidden banner adds no height"
			await expect(
				canvasElement.querySelector('pwa-install-banner'),
			).not.toBeNull()
			await expect(
				canvasElement.querySelector('signup-prompt-banner'),
			).not.toBeNull()
			await expect(
				canvasElement.querySelectorAll('.bottom-banner'),
			).toHaveLength(0)
			await openSnack(canvasElement)
			const gap =
				box(nav(canvasElement)).top -
				box(one(canvasElement, '.snack-item')).bottom
			await expect(
				Math.abs(gap - px(canvasElement, 'var(--space-s)')),
			).toBeLessThan(1)
		})
	},
} satisfies Story

/**
 * The first-visit area dialog on the dashboard: it opens in the top layer,
 * the bar keeps its place at the bottom of the grid, and the backdrop dims
 * the page, bar included.
 */
export const AreaDialogOverTheBar = {
	render: () =>
		shell({
			signedIn: false,
			page: `${PLAIN_PAGE}<user-home-selector required.bind="true"></user-home-selector>`,
			pageRegister: [UserHomeSelector],
		}),
	play: async ({ canvasElement }) => {
		await atSize(390, 844, async () => {
			await shown(canvasElement)
			CustomElement.for<UserHomeSelector>(
				one(canvasElement, 'user-home-selector'),
			).viewModel.open()
			const dialog = await waitFor(() => {
				const el = one(canvasElement, 'user-home-selector dialog')
				if (!el.matches(':popover-open')) throw new Error('not open yet')
				return el
			})
			// @spec components/infrastructure/fan/web/global/bottom-nav-bar "Navigation remains visible beneath area setup dialog"
			await expect(dialog.matches(':popover-open')).toBe(true)
			await expect(box(nav(canvasElement)).bottom).toBe(innerHeight)
			await expect(
				getComputedStyle(dialog, '::backdrop').backgroundColor,
			).not.toBe('rgba(0, 0, 0, 0)')
		})
	},
} satisfies Story

// ---- real routes in the shell --------------------------------------------

/** Settings' fakes (cf. settings-route.stories.ts), for a signed-in fan. */
const SETTINGS_ITEMS: Record<string, [unknown, object]> = {
	auth: [
		IAuthService,
		{ emailVerified: true, refreshEmailVerified: async () => {} },
	],
	userStore: [
		IUserStore,
		{ currentLanguage: 'ja', currentHome: 'JP-13', current: undefined },
	],
	storage: [ILocalStorage, {}],
	push: [IPushService, { resolvePushState: async () => 'disabled' }],
	audio: [IAudioEngine, { muted: false, volume: 1 }],
	appConfig: [IAppConfig, { vapidPublicKey: '' }],
	identity: [
		IIdentityVerificationService,
		{
			current: undefined,
			failure: null,
			get: async () => undefined,
			takeVerifiedNotice: () => false,
		},
	],
	consent: [IConsentService, { analytics: true, sessionReplay: true }],
}

/**
 * Settings scrolled to its end while the install banner is visible: the
 * Sign out row lies above the banner and a tap there reaches the row.
 */
export const SettingsEndsAboveTheBanner = {
	render: () =>
		shell({
			tab: false,
			titleKey: 'nav.settings',
			installBanner: true,
			page: '<settings-route></settings-route>',
			pageRegister: [
				SettingsRoute,
				ListItem,
				SettingsSwitchRow,
				SettingsConsentRow,
				SettingsStatusRow,
				UserHomeSelector,
				ConfirmDialog,
			],
			pageItems: SETTINGS_ITEMS,
		}),
	play: async ({ canvasElement }) => {
		await atSize(320, 568, async () => {
			const row = await waitFor(() => one(canvasElement, '.settings-sign-out'))
			await settled(one(canvasElement, 'pwa-install-banner'))
			one(canvasElement, '[data-testid="settings-scroll"]').scrollTo({
				top: 1e6,
			})
			// @spec components/infrastructure/fan/web/global/app-shell "Last row clears the banner"
			const bannerTop = box(banner(canvasElement)).top
			await expect(box(row).bottom).toBeLessThanOrEqual(bannerTop + 0.5)
			await expect(
				Math.abs(routeAreaBottom(canvasElement) - bannerTop),
			).toBeLessThan(1)
			await expect(tapAt(row)).toBe('target')
		})
	},
} satisfies Story

/** My Artists' fakes (cf. my-artists-route.stories.ts), for a guest. */
function myArtistsItems(follows: FollowedArtist[]) {
	return {
		follow: [
			IFollowStore,
			{
				listFollowed: async () => follows,
				unfollow: async () => {},
				setHype: async () => {},
			},
		],
		userStore: [
			IUserStore,
			{ needsHome: false, currentHome: 'JP-13', saveHome: async () => {} },
		],
		pushOffer: [IPushOfferService, { pushState: async () => 'on' }],
		storage: [ILocalStorage, { getItem: () => '1', setItem: noop }],
	} satisfies Record<string, [unknown, object]>
}

const MY_ARTISTS_REGISTER = [
	MyArtistsRoute,
	PageHelp,
	StatePlaceholder,
	UserHomeSelector,
	SignupPromptBanner,
]

/** Run the route's `loading` hook (no router runs here). */
async function loadMyArtists(root: HTMLElement): Promise<void> {
	const host = await waitFor(() => one(root, 'my-artists-route'))
	await CustomElement.for<MyArtistsRoute>(host).viewModel.loading()
}

/**
 * A guest with no followed artist on My Artists, the signup prompt visible:
 * the empty state's button lies above the banner and a tap there reaches it,
 * not the banner or the FAB.
 */
export const EmptyStateAboveTheBanner = {
	render: () =>
		shell({
			signedIn: false,
			titleKey: 'nav.myArtists',
			page: '<my-artists-route></my-artists-route>',
			pageRegister: MY_ARTISTS_REGISTER,
			pageItems: myArtistsItems([]),
		}),
	play: async ({ canvasElement }) => {
		await atSize(320, 568, async () => {
			await loadMyArtists(canvasElement)
			const button = await waitFor(() =>
				one(canvasElement, '[data-testid="discover-link"]'),
			)
			const prompt = await waitFor(() =>
				one(canvasElement, 'signup-prompt-banner .bottom-banner'),
			)
			await settled(one(canvasElement, 'signup-prompt-banner'))
			await shown(canvasElement)
			// @spec components/infrastructure/fan/web/global/app-shell "Empty state clears the banner and the FAB"
			await expect(box(button).bottom).toBeLessThanOrEqual(
				box(prompt).top + 0.5,
			)
			await expect(
				Math.abs(routeAreaBottom(canvasElement) - box(prompt).top),
			).toBeLessThan(1)
			await expect(tapAt(button)).toBe('target')
		})
	},
} satisfies Story

/**
 * My Artists in edit mode with three followed artists: removing one opens the
 * undo snack above the Done bar, and a tap on Done still reaches it.
 */
export const DoneBarStaysTappable = {
	render: () =>
		shell({
			signedIn: false,
			titleKey: 'nav.myArtists',
			page: '<my-artists-route></my-artists-route>',
			pageRegister: MY_ARTISTS_REGISTER,
			pageItems: myArtistsItems(
				['YOASOBI', 'Vaundy', 'Ado'].map((name, i) => ({
					artist: { id: `artist-${i + 1}`, name, mbid: '' },
					hype: 'watch',
				})),
			),
		}),
	play: async ({ canvasElement }) => {
		await atSize(412, 915, async () => {
			await loadMyArtists(canvasElement)
			await waitFor(() =>
				expect(canvasElement.querySelectorAll('.artist-row')).toHaveLength(3),
			)
			await shown(canvasElement)
			await openArc(canvasElement)
			await userEvent.click(
				one(canvasElement, 'fab-menu .fab-item[data-action-id="edit"]'),
			)
			const done = await waitFor(() =>
				one<HTMLButtonElement>(canvasElement, '.edit-action-bar button'),
			)
			await userEvent.click(one(canvasElement, '.artist-remove-btn'))
			// The row leaves in a View Transition; until it ends, the page is
			// its snapshot and a tap lands on the root (my-artists-route.ts
			// clears this class when the transition finishes).
			await waitFor(
				() =>
					expect(
						document.documentElement.classList.contains('vt-suppress-root'),
					).toBe(false),
				{ timeout: 5000 },
			)
			const snack = await waitFor(() =>
				one(canvasElement, '.snack-item:popover-open'),
			)
			await settled(snack)
			// @spec components/infrastructure/fan/web/global/snack-bar "The Done bar of edit mode stays tappable"
			// One space-3xs step (4 px) above the bar.
			const gap =
				box(one(canvasElement, '.edit-action-bar')).top - box(snack).bottom
			await expect(Math.abs(gap - 4)).toBeLessThan(1)
			await expect(tapAt(done)).toBe('target')
			await userEvent.click(done)
			await waitFor(() =>
				expect(canvasElement.querySelectorAll('.edit-action-bar')).toHaveLength(
					0,
				),
			)
		})
	},
} satisfies Story
