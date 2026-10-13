import AxeBuilder from '@axe-core/playwright'
import { OIDC_AUTHORITY } from '../support/auth-mocks'
import {
	installConsole,
	ORG,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	jst,
	organizer,
	payoutAccount,
	type SaleSpec,
	salesOf,
	scanner,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import {
	expectLayerOrderDeclaredFirst,
	expectOwnStyles,
	type StyleExpectation,
} from '../support/rendered-styles'
import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Every public screen of each entry (fan, organizer, admin) and every console
 * screen with mocked RPCs, rendered from the PRODUCTION build. Each screen
 * fails on any axe violation and when its component styles are not applied.
 * The four projects of `playwright.prod-build.config.mjs` run each screen in
 * light and dark at 390 × 844 and 1280 × 800.
 * OpenSpec change `redesign-organizer-console`, design D22.
 */

const ORIGIN = 'http://localhost:9100'
/** `public/config.json`, which `vite preview` serves to the fan and admin entries. */
const DEV_CLIENT_ID = '371355407710421859'
/** "Now" for the console: before the sales below open. */
const NOW = new Date('2026-10-08T09:00:00+09:00')

interface Probe {
	/** Names the element in the failure message. */
	what: string
	locate: (page: Page) => Locator
	expect: StyleExpectation
}

interface Screen {
	name: string
	path: string
	setup: (page: Page) => Promise<void>
	/** Visible once the screen has rendered its content. */
	ready: (page: Page) => Locator
	/** Brings the screen into the state checked, e.g. opens a menu. */
	act?: (page: Page) => Promise<void>
	probes: Probe[]
}

// ---------------------------------------------------------------- fan entry

/** Every fan RPC answers an empty message: the public screens need no data. */
async function fanGuest(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: '{}',
		}),
	)
}

const fanRouteHost = (route: string, what: string): Probe => ({
	what,
	locate: (page) => page.locator(route),
	expect: { padding: true },
})

const FAN: Screen[] = [
	{
		name: 'fan /welcome',
		path: '/welcome',
		setup: fanGuest,
		ready: (page) => page.locator('.welcome-btn-primary'),
		probes: [
			{
				what: "the welcome page's primary button",
				locate: (page) => page.locator('.welcome-btn-primary'),
				expect: { padding: true, background: true },
			},
			{
				what: "the welcome page's secondary button",
				locate: (page) => page.locator('.welcome-btn-secondary'),
				expect: { padding: true },
			},
		],
	},
	{
		name: 'fan /about',
		path: '/about',
		setup: fanGuest,
		ready: (page) => page.locator('.about-card'),
		probes: [
			{
				what: "the about page's card",
				locate: (page) => page.locator('.about-card'),
				expect: { padding: true, background: true },
			},
		],
	},
	{
		name: 'fan /legal/terms',
		path: '/legal/terms',
		setup: fanGuest,
		ready: (page) => page.locator('legal-document h1'),
		probes: [fanRouteHost('legal-document', 'the terms document')],
	},
	{
		name: 'fan /legal/privacy',
		path: '/legal/privacy',
		setup: fanGuest,
		ready: (page) => page.locator('legal-document h1'),
		probes: [fanRouteHost('legal-document', 'the privacy document')],
	},
	{
		name: 'fan /legal/licenses',
		path: '/legal/licenses',
		setup: fanGuest,
		ready: (page) => page.locator('.licenses-title'),
		probes: [fanRouteHost('licenses-route', 'the licenses page')],
	},
]

// ---------------------------------------------------------- organizer entry

const OPEN_LOTTERY: SaleSpec = {
	id: 'sale-open',
	name: 'ファンクラブ先行',
	method: 'LOTTERY',
	start: jst('2026-10-05', '12:00'),
	end: jst('2026-10-12', '23:59'),
	price: 6500,
	quantity: 1200,
	perAccountLimit: 4,
	stats: { entries: 412, requested: 1380 },
}

const GENERAL: SaleSpec = {
	id: 'sale-general',
	name: '一般発売',
	method: 'FIRST_COME',
	start: jst('2026-10-20', '10:00'),
	end: jst('2026-11-03', '17:00'),
	price: 7000,
	quantity: 150,
	perAccountLimit: 4,
	typeState: 'NOT_YET_ON_SALE',
	sold: 0,
	held: 0,
}

/** A lottery that has not opened yet, so its editor is editable. */
const LATER_LOTTERY: SaleSpec = {
	...OPEN_LOTTERY,
	id: 'sale-later',
	name: '先行抽選',
	start: jst('2026-10-25', '12:00'),
	end: jst('2026-10-30', '23:59'),
	stats: { entries: 0, requested: 0 },
}

/** One organizer with a tour on sale and a draft solo show. */
const CONSOLE_RPC: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1103', [
		OPEN_LOTTERY,
		LATER_LOTTERY,
		GENERAL,
	]),
	'ScannerService/ListByEvent': {
		scanners: [
			scanner('e-1103', {
				id: 'sc-1',
				number: 1,
				status: 'IN_USE',
				token: 'token-1',
				bindTime: jst('2026-10-07', '18:00'),
			}),
			scanner('e-1103', { id: 'sc-2', number: 2, status: 'UNUSED' }),
		],
	},
	'ArtistService/List': {
		artists: [{ id: { value: 'a-1' }, name: { value: 'Band A' } }],
	},
	'VenueService/Search': { candidates: [] },
}

function consoleAs(owner = true, rpc: RpcMocks = {}) {
	return async (page: Page) => {
		await page.clock.setFixedTime(NOW)
		await installConsole(page, {
			rpc: { ...CONSOLE_RPC, ...rpc },
			language: 'ja',
			owner,
			origin: ORIGIN,
		})
	}
}

const pageTitle = (page: Page) => page.getByRole('heading', { level: 1 })

/** The first console button of the screen, in its own shell. */
const consoleButton: Probe = {
	what: 'a console button',
	locate: (page) => page.locator('console-button').locator('a, button').first(),
	expect: { padding: true },
}

const filledButton: Probe = {
	what: 'the filled console button',
	locate: (page) =>
		page.locator('console-button').locator('[data-variant="filled"]').first(),
	expect: { padding: true, background: true },
}

/** A list item's link: the whole item is the target. */
const listItem: Probe = {
	what: 'a list item',
	locate: (page) => page.locator('list-item').locator('a').first(),
	expect: { padding: true },
}

/** 公演をつくる, the extended FAB. */
const fab: Probe = {
	what: 'the extended FAB',
	locate: (page) => page.locator('extended-fab').locator('a'),
	expect: { padding: true, background: true },
}

/** An open overflow menu's container. */
const openMenu: Probe = {
	what: 'the open overflow menu',
	locate: (page) => page.getByRole('menu', { name: 'その他の操作' }),
	expect: { padding: true, background: true },
}

/** Opens the first overflow menu of the screen. */
async function openFirstMenu(page: Page): Promise<void> {
	await page
		.locator('overflow-menu')
		.first()
		.getByRole('button', { name: 'その他の操作' })
		.click()
	await expect(page.getByRole('menu')).toBeVisible()
}

const SALES = `${SERIES}/s-tour/events/e-1103/ticket-sales`

const ORGANIZER: Screen[] = [
	['Home', ORG, [listItem]],
	['Concerts', SERIES, [fab]],
	['Concert', `${SERIES}/s-tour`, [consoleButton, listItem]],
	['Concert with draft dates', `${SERIES}/s-solo`, [filledButton]],
	['Concert editor (new)', `${SERIES}/new`, [filledButton]],
	['Concert editor (edit)', `${SERIES}/s-tour/edit`, [filledButton]],
	['Event, Sales tab', SALES, [consoleButton]],
	[
		'Event, draft (Reception tab)',
		`${SERIES}/s-solo/events/e-1220/scanners`,
		[filledButton],
	],
	[
		'Event, Reception tab',
		`${SERIES}/s-tour/events/e-1103/scanners`,
		[consoleButton],
	],
	['Lottery sale editor (new)', `${SALES}/new?method=lottery`, [filledButton]],
	[
		'Lottery sale editor (edit)',
		`${SALES}/${LATER_LOTTERY.id}/edit`,
		[filledButton],
	],
	['First-come sale editor', `${SALES}/${GENERAL.id}/edit`, [filledButton]],
	[
		'Settings',
		`${ORG}/settings`,
		[
			{
				what: "the payout account's status badge",
				locate: (page: Page) => page.locator('status-badge .badge'),
				expect: { padding: true, background: true },
			},
		],
	],
].map(([name, path, probes]) => ({
	name: `organizer ${name}`,
	path: path as string,
	setup: consoleAs(),
	ready: pageTitle,
	probes: probes as Probe[],
}))

ORGANIZER.push(
	{
		name: 'organizer denied (no owner role)',
		path: ORG,
		setup: consoleAs(false),
		ready: pageTitle,
		probes: [filledButton],
	},
	{
		name: 'organizer another Organizer’s address',
		path: '/organizers/org-other',
		setup: consoleAs(),
		ready: pageTitle,
		probes: [filledButton],
	},
	{
		name: 'organizer Event, menu open',
		path: `${SERIES}/s-tour/events/e-1103/scanners`,
		setup: consoleAs(),
		ready: pageTitle,
		act: openFirstMenu,
		probes: [openMenu],
	},
	{
		name: 'organizer Concerts (no represented Artist)',
		path: `${ORG}/artists`,
		setup: consoleAs(true, { 'ArtistService/List': { artists: [] } }),
		ready: pageTitle,
		probes: [],
	},
)

// -------------------------------------------------------------- admin entry

/** Serve `admin.html` for every document, signed in as an admin. */
async function adminSignedIn(page: Page): Promise<void> {
	await page.route(
		(url) => url.origin === ORIGIN,
		async (route) => {
			if (route.request().resourceType() !== 'document') {
				return route.fallback()
			}
			const response = await route.fetch({ url: `${ORIGIN}/admin.html` })
			return route.fulfill({ response })
		},
	)
	await page.addInitScript(
		({ key }) => {
			localStorage.setItem(
				key,
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: {
						sub: '00000000-0000-4000-8000-0000000000ad',
						preferred_username: 'admin@e2e.liverty-music.app',
					},
					expires_at: 9999999999,
				}),
			)
		},
		{ key: `oidc.user:${OIDC_AUTHORITY}:${DEV_CLIENT_ID}` },
	)
}

const ADMIN: Screen[] = [
	{
		name: 'admin welcome',
		path: '/welcome',
		setup: adminSignedIn,
		ready: pageTitle,
		probes: [
			{
				what: "the admin welcome page's card",
				locate: (page) => page.locator('.admin-welcome-card'),
				expect: { padding: true },
			},
		],
	},
]

// -------------------------------------------------------------------- checks

/** Wait until finite animations (entrances, view transitions) have ended. */
async function settle(page: Page): Promise<void> {
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => {
					const t = a.effect?.getComputedTiming()
					return t && Number.isFinite(t.endTime as number)
				})
				.map((a) => a.finished.catch(() => undefined)),
		),
	)
}

/**
 * Axe violations present on main when this check was added (2026-10-13), each
 * with the work that removes it. Any other violation fails the check, and so
 * does an entry here that no longer occurs: delete the entry with the fix.
 */
const KNOWN_VIOLATIONS: Array<{
	screen: string
	rule: string
	/** Window sizes it occurs at; both when omitted. */
	only?: 'phone' | 'desktop'
	reason: string
}> = [
	...['fan /legal/terms', 'fan /legal/privacy', 'fan /legal/licenses'].flatMap(
		(screen) => [
			{
				screen,
				rule: 'landmark-one-main',
				reason: 'The fan app shell puts the route outlet in no <main>.',
			},
			{
				screen,
				rule: 'region',
				reason: 'The fan app shell puts the route outlet in no landmark.',
			},
		],
	),
	...['fan /legal/terms', 'fan /legal/privacy'].map((screen) => ({
		screen,
		rule: 'scrollable-region-focusable',
		reason:
			'The legal route host scrolls but holds no focusable element and has no tabindex.',
	})),
	{
		screen: 'fan /welcome',
		rule: 'landmark-one-main',
		reason: 'The welcome route (no chrome) has no <main>.',
	},
	{
		screen: 'fan /welcome',
		rule: 'color-contrast',
		reason:
			'White on the brand magenta #fd00a6 of `.welcome-btn-primary` is 3.66:1.',
	},
	{
		screen: 'organizer Event, Sales tab',
		rule: 'heading-order',
		reason:
			'Sale cards use <h3> under the <h1>. Redesigned by `redesign-organizer-console` D18.',
	},
]

async function expectNoAxeViolations(
	page: Page,
	screen: string,
	size: 'phone' | 'desktop',
): Promise<void> {
	const { violations } = await new AxeBuilder({ page }).analyze()
	const known = new Set(
		KNOWN_VIOLATIONS.filter(
			(k) => k.screen === screen && (!k.only || k.only === size),
		).map((k) => k.rule),
	)
	const report = violations
		.filter((v) => !known.has(v.id))
		.map(
			(v) =>
				`${v.id} (${v.impact}): ${v.help}\n${v.nodes
					.slice(0, 3)
					.map(
						(n) =>
							`    ${n.target.join(' ')} — ${n.failureSummary?.split('\n').join(' ')}`,
					)
					.join(
						'\n',
					)}${v.nodes.length > 3 ? `\n    … and ${v.nodes.length - 3} more` : ''}`,
		)
	expect.soft(report, `axe violations:\n${report.join('\n')}`).toEqual([])

	const found = new Set(violations.map((v) => v.id))
	const fixed = [...known].filter((rule) => !found.has(rule))
	expect
		.soft(
			fixed,
			'Recorded axe violations that no longer occur: delete them from KNOWN_VIOLATIONS.',
		)
		.toEqual([])
}

for (const screen of [...FAN, ...ORGANIZER, ...ADMIN]) {
	test(`${screen.name} renders with its styles and passes axe`, async ({
		page,
	}, testInfo) => {
		await screen.setup(page)
		await page.goto(screen.path)
		await expect(screen.ready(page).first()).toBeVisible()
		await screen.act?.(page)
		await settle(page)

		await expectLayerOrderDeclaredFirst(page)
		for (const probe of screen.probes) {
			await expectOwnStyles(probe.locate(page), probe.what, probe.expect)
		}
		const size = testInfo.project.name.includes('phone') ? 'phone' : 'desktop'
		await expectNoAxeViolations(page, screen.name, size)
	})
}

// Entries whose public screen is the sign-in redirect itself.
for (const entry of ['organizer', 'admin'] as const) {
	test(`${entry} sends a signed-out visitor to sign-in`, async ({ page }) => {
		if (entry === 'organizer') {
			await installConsole(page, { origin: ORIGIN })
			await page.addInitScript(() => {
				for (const key of Object.keys(localStorage)) {
					if (key.startsWith('oidc.user:')) localStorage.removeItem(key)
				}
			})
		} else {
			await page.route(
				(url) => url.origin === ORIGIN,
				async (route) => {
					if (route.request().resourceType() !== 'document') {
						return route.fallback()
					}
					const response = await route.fetch({ url: `${ORIGIN}/admin.html` })
					return route.fulfill({ response })
				},
			)
		}
		await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: 'sign-in' }),
		)
		const authorize = page.waitForRequest((r) =>
			r.url().startsWith(`${OIDC_AUTHORITY}/oauth/v2/authorize`),
		)
		// Each entry's signed-in landing route.
		await page.goto(entry === 'organizer' ? ORG : '/welcome')
		await authorize
	})
}
