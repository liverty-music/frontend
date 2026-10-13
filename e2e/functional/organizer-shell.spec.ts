import { OIDC_AUTHORITY } from '../support/auth-mocks'
import {
	consoleStorage,
	installConsole,
	type RpcMocks,
} from '../support/organizer'
import {
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
	'ArtistService/List': { artists: [] },
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
		await expect(page).toHaveURL(/\/home$/)
	})

	test(`@spec ${SPEC} "Old or unknown address"`, async ({ page }) => {
		await open(page, '/lottery/status/abc')
		await expect(
			page.getByRole('heading', { level: 1, name: 'ホーム' }),
		).toBeVisible()
	})

	test(`@spec ${SPEC} "Account without the owner role"`, async ({ page }) => {
		await installConsole(page, { rpc: RPC, language: 'ja', owner: false })
		await page.goto('/concerts')
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
		await page.goto('/concerts/s-tour')

		const request = await authorize
		const state = new URL(request.url()).searchParams.get('state')
		expect(state).toBeTruthy()
		// The address opened is carried through sign-in in the OIDC state.
		const stored = (await consoleStorage(page))[`oidc.${state}`]
		expect(JSON.parse(stored ?? '{}').data).toEqual({
			returnTo: '/concerts/s-tour',
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
		await open(page, '/concerts/s-tour/events/e-1103/sales')
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
		await open(page, '/concerts/s-tour/events/e-1103/sales')
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
		await open(page, '/home')
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
		await open(page, '/home')
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
		await open(page, '/concerts/s-tour')
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
		await open(page, '/concerts/s-tour/events/e-1103/sales')
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
		await open(page, '/concerts/s-tour/events/e-1103/sales')
		const links = breadcrumb(page).getByRole('link')
		await expect(links).toHaveCount(1)
		await expect(links).toHaveText('XX Tour 2026')
		await expect(links).toHaveAttribute('href', /\/concerts\/s-tour$/)
	})

	test(`@spec ${SPEC} "Every screen reached by navigation"`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await open(page, '/home')

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
		await expect(page).toHaveURL(/\/events\/e-1103\/sales$/)

		await page.getByRole('link', { name: '受付', exact: true }).click()
		await expect(page).toHaveURL(/\/events\/e-1103\/reception$/)
		await expect(
			page.getByRole('button', { name: '受付リンクを発行' }),
		).toBeVisible()

		await page.getByRole('link', { name: '販売', exact: true }).click()
		await page.getByRole('link', { name: '抽選で販売する' }).click()
		await expect(page).toHaveURL(/\/sales\/lottery\/new$/)
		await expect(
			page.getByRole('heading', { level: 1, name: '抽選で販売する' }),
		).toBeVisible()

		await nav(page).getByRole('link', { name: '設定' }).click()
		await expect(
			page.getByRole('heading', { level: 1, name: '設定' }),
		).toBeVisible()
	})
})
