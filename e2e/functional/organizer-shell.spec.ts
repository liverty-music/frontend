import { OIDC_AUTHORITY } from '../support/auth-mocks'
import {
	consoleStorage,
	installConsole,
	ORG,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	artistList,
	type ConcertSpec,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The console frame: who gets in, where they land, and the navigation, top
 * bar and breadcrumb around every screen.
 */

const RPC: RpcMocks = {
	'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'TicketSaleService/ListByEvent': salesOf('e-1103', []),
	'ScannerService/ListByEvent': { scanners: [] },
}

const SPEC = 'components/infrastructure/organizer/web/global/organizer-shell'

const nav = (page: Page) =>
	page.getByRole('navigation', { name: 'メインナビゲーション' })

async function open(page: Page, path: string, rpc: RpcMocks = RPC) {
	await installConsole(page, { rpc, language: 'ja' })
	await page.goto(path)
}

test.describe('who enters and where they land', () => {
	test(`@spec ${SPEC} "Owner lands on Home"`, async ({ page }) => {
		await open(page, '/')
		await expect(
			page.getByRole('heading', { level: 1, name: 'ホーム' }),
		).toBeVisible()
		await expect(page).toHaveURL(/\/organizers\/org-1$/)
	})

	test(`@spec ${SPEC} "Old or unknown address"`, async ({ page }) => {
		await installConsole(page, { rpc: RPC, language: 'ja' })
		for (const address of ['/lottery/status/abc', '/concerts', '/home']) {
			await page.goto(address)
			await expect(
				page.getByRole('heading', { level: 1, name: 'ホーム' }),
			).toBeVisible()
			await expect(page).toHaveURL(/\/organizers\/org-1$/)
		}
	})

	test(`@spec ${SPEC} "Account without the owner role"`, async ({ page }) => {
		await installConsole(page, { rpc: RPC, language: 'ja', owner: false })
		await page.goto(SERIES)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'このアカウントではコンソールを使えません',
		)
		await expect(
			page.getByRole('button', { name: 'サインアウト' }),
		).toBeVisible()
		await expect(nav(page)).toHaveCount(0)
		await expect(page.getByRole('heading', { name: '公演' })).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Unauthenticated visitor goes to sign-in"`, async ({
		page,
	}) => {
		await installConsole(page, { rpc: RPC })
		await page.addInitScript(() => {
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith('oidc.user:')) localStorage.removeItem(key)
			}
		})
		const authorize = page.waitForRequest((r) =>
			r.url().startsWith(`${OIDC_AUTHORITY}/oauth/v2/authorize`),
		)
		await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: 'sign-in' }),
		)
		await page.goto(`${SERIES}/s-tour`)

		const request = await authorize
		const state = new URL(request.url()).searchParams.get('state')
		expect(state).toBeTruthy()
		// The address opened is carried through sign-in in the OIDC state.
		const stored = (await consoleStorage(page))[`oidc.${state}`]
		expect(JSON.parse(stored ?? '{}').data).toEqual({
			returnTo: `${SERIES}/s-tour`,
		})
	})
})

test.describe('navigation', () => {
	test(`@spec ${SPEC} "Sign out from any screen"`, async ({ page }) => {
		await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: 'signed out',
			}),
		)
		await open(page, `${SERIES}/s-tour/events/e-1103/ticket-sales`)
		await expect(
			page.getByRole('link', { name: '販売', exact: true }),
		).toBeVisible()

		const endSession = page.waitForRequest((r) =>
			r.url().startsWith(`${OIDC_AUTHORITY}/oidc/v1/end_session`),
		)
		await page.getByRole('button', { name: 'アカウント' }).click()
		await page.getByRole('button', { name: 'サインアウト' }).click()
		await endSession

		const storage = await consoleStorage(page)
		expect(Object.keys(storage).some((k) => k.startsWith('oidc.user:'))).toBe(
			false,
		)

		// Back does not reopen the event page signed in: it goes to sign-in.
		await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: 'sign-in' }),
		)
		await page.goBack()
		await expect(page.locator('body')).toHaveText('sign-in')
	})

	test(`@spec ${SPEC} "Current destination on a deep page"`, async ({
		page,
	}) => {
		await open(page, `${SERIES}/s-tour/events/e-1103/ticket-sales`)
		await expect(nav(page).getByRole('link', { name: '公演' })).toHaveAttribute(
			'aria-current',
			'page',
		)
		await expect(
			nav(page).getByRole('link', { name: 'ホーム' }),
		).not.toHaveAttribute('aria-current', 'page')
	})

	test(`@spec ${SPEC} "Phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await open(page, ORG)
		const box = await nav(page).boundingBox()
		expect(box).not.toBeNull()
		expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844)
		expect(box?.width).toBe(390)
		for (const name of ['ホーム', '公演', '設定']) {
			await expect(nav(page).getByRole('link', { name })).toBeVisible()
		}
	})

	test(`@spec ${SPEC} "PC"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, ORG)
		const box = await nav(page).boundingBox()
		expect(box?.x).toBe(0)
		expect(box?.width).toBeLessThanOrEqual(80)
		expect(box?.height).toBeGreaterThan(400)
		// No bar along the bottom edge.
		expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(800)
		expect(box?.y).toBeLessThan(100)
	})

	test(`@spec ${SPEC} "Window resized"`, async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 600 })
		await open(page, `${SERIES}/s-tour`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()
		const main = page.locator('organizer-shell main')
		await main.evaluate((el) => {
			const filler = document.createElement('div')
			filler.style.blockSize = '2000px'
			el.querySelector('.page')?.append(filler)
			el.scrollTop = 300
		})

		await page.setViewportSize({ width: 560, height: 600 })

		const box = await nav(page).boundingBox()
		expect(box?.width).toBe(560)
		expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(600)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeAttached()
		expect(await main.evaluate((el) => el.scrollTop)).toBe(300)
	})
})

test.describe('breadcrumb', () => {
	const breadcrumb = (page: Page) =>
		page.getByRole('navigation', { name: 'パンくずリスト' })

	test(`@spec ${SPEC} "Breadcrumb on an event"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, `${SERIES}/s-tour/events/e-1103/ticket-sales`)
		const trail = breadcrumb(page).getByRole('listitem')
		await expect(trail).toHaveText(['公演', 'XX Tour 2026', '11月3日(火)'])
		await expect(
			breadcrumb(page).getByRole('link', { name: '公演' }),
		).toBeVisible()
		await expect(
			breadcrumb(page).getByRole('link', { name: 'XX Tour 2026' }),
		).toBeVisible()
		await expect(
			breadcrumb(page).getByRole('link', { name: '11月3日(火)' }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Breadcrumb on a phone"`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await open(page, `${SERIES}/s-tour/events/e-1103/ticket-sales`)
		const links = breadcrumb(page).getByRole('link')
		await expect(links).toHaveCount(1)
		await expect(links).toHaveText('XX Tour 2026')
		await expect(links).toHaveAttribute('href', /\/series\/s-tour$/)
	})

	test(`@spec ${SPEC} "Every screen reached by navigation"`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, ORG)

		await nav(page).getByRole('link', { name: '公演' }).click()
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()

		await page.getByRole('link', { name: 'XX Tour 2026' }).first().click()
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()

		await page
			.getByRole('link', { name: /11月3日\(火\) 18:00 JST/ })
			.first()
			.click()
		await expect(page).toHaveURL(/\/events\/e-1103\/ticket-sales$/)

		await page.getByRole('link', { name: '受付', exact: true }).click()
		await expect(page).toHaveURL(/\/events\/e-1103\/scanners$/)
		await expect(
			page.getByRole('button', { name: '受付リンクを発行' }),
		).toBeVisible()

		await page.getByRole('link', { name: '販売', exact: true }).click()
		await page.getByRole('link', { name: '抽選で販売する' }).click()
		await expect(page).toHaveURL(/\/ticket-sales\/new\?method=lottery$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '抽選で販売する' }),
		).toBeVisible()

		await nav(page).getByRole('link', { name: '設定' }).click()
		await expect(
			page.getByRole('heading', { level: 1, name: '設定' }),
		).toBeVisible()
	})
})

test.describe('addresses name the Organizer and the Artist', () => {
	/** XX × YY 2026: Band A and Band B, both represented, perform. */
	const XX_YY: ConcertSpec = {
		id: 's-xy',
		title: 'XX × YY 2026',
		type: 'FESTIVAL',
		performers: [
			{ id: 'a-1', name: 'Band A' },
			{ id: 'a-2', name: 'Band B' },
		],
		events: [
			{
				id: 'e-xy',
				date: '2026-11-21',
				start: '17:00',
				venue: 'Zepp Haneda',
				state: 'PUBLISHED',
			},
		],
	}
	/** Only Band B performs in YY Live. */
	const YY_LIVE: ConcertSpec = {
		id: 's-yy',
		title: 'YY Live',
		performers: [{ id: 'a-2', name: 'Band B' }],
		events: [
			{ id: 'e-yy', date: '2026-12-01', start: '19:00', venue: 'O-EAST' },
		],
	}
	const TWO_ARTISTS: RpcMocks = {
		...RPC,
		'SeriesService/List': seriesList([XX_TOUR, XX_SOLO, XX_YY, YY_LIVE]),
		'ArtistService/List': artistList('Band A', 'Band B'),
	}
	/** The concerts listed: rows of the table on a PC, cards on a phone. */
	const concertLinks = (page: Page) =>
		page.locator('concerts-route').getByRole('link')

	test(`@spec ${SPEC} "Copied address"`, async ({ page, browser }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, ORG)
		await nav(page).getByRole('link', { name: '公演' }).click()
		await page.getByRole('link', { name: 'XX Tour 2026' }).first().click()
		await page
			.getByRole('link', { name: /11月3日\(火\) 18:00 JST/ })
			.first()
			.click()
		await expect(page).toHaveURL(/\/ticket-sales$/)
		const copied = page.url()
		expect(new URL(copied).pathname).toBe(
			`${SERIES}/s-tour/events/e-1103/ticket-sales`,
		)

		// Another operator of the same Organizer, on another device.
		const other = await browser.newContext({
			viewport: { width: 1280, height: 800 },
		})
		const second = await other.newPage()
		await installConsole(second, { rpc: RPC, language: 'ja' })
		await second.goto(copied)
		await expect(second).toHaveURL(copied)
		await expect(
			second.getByRole('link', { name: '販売', exact: true }),
		).toHaveAttribute('aria-current', 'page')
		await expect(
			second.getByRole('heading', { level: 1, name: /11月3日\(火\)/ }),
		).toBeVisible()
		await other.close()
	})

	test(`@spec ${SPEC} "Co-headlined concert"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, `${ORG}/artists/a-1/series`, TWO_ARTISTS)
		await expect(
			concertLinks(page).filter({ hasText: 'XX × YY 2026' }),
		).toHaveCount(1)

		await page.goto(`${ORG}/artists/a-2/series`)
		await expect(
			concertLinks(page).filter({ hasText: 'XX × YY 2026' }),
		).toHaveCount(1)
		await concertLinks(page).filter({ hasText: 'XX × YY 2026' }).click()
		await expect(page).toHaveURL(/\/artists\/a-2\/series\/s-xy$/)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX × YY 2026' }),
		).toBeVisible()

		// The breadcrumb follows the Artist in the address.
		const crumbs = page.getByRole('navigation', { name: 'パンくずリスト' })
		await expect(crumbs.getByRole('link', { name: '公演' })).toHaveAttribute(
			'href',
			/\/organizers\/org-1\/artists\/a-2\/series$/,
		)
		await page.goto(`${ORG}/artists/a-1/series/s-xy`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX × YY 2026' }),
		).toBeVisible()
		await expect(crumbs.getByRole('link', { name: '公演' })).toHaveAttribute(
			'href',
			/\/organizers\/org-1\/artists\/a-1\/series$/,
		)
	})

	test(`@spec ${SPEC} "Another Organizer's address"`, async ({ page }) => {
		const log = await installConsole(page, { rpc: RPC, language: 'ja' })
		await page.goto('/organizers/org-9/artists/a-1/series/s-tour')
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'このアドレスは別の主催者のページです',
		)
		await expect(
			page.getByRole('button', { name: 'サインアウト' }),
		).toBeVisible()
		await expect(nav(page)).toHaveCount(0)
		await expect(page.getByText('XX Tour 2026')).toHaveCount(0)
		expect(log.calls.map((c) => c.method)).not.toContain('SeriesService/List')
	})

	test(`@spec ${SPEC} "No represented Artist yet"`, async ({ page }) => {
		await open(page, ORG, { ...RPC, 'ArtistService/List': { artists: [] } })
		await nav(page).getByRole('link', { name: '公演' }).click()
		await expect(page).toHaveURL(/\/organizers\/org-1\/artists$/)
		await expect(page.getByText('所属アーティストがまだいません')).toBeVisible()
		await expect(
			page.getByText(/所属アーティストの追加は Liverty Music が承ります/),
		).toBeVisible()
		await expect(page.getByRole('link', { name: '公演をつくる' })).toHaveCount(
			0,
		)
	})
})
