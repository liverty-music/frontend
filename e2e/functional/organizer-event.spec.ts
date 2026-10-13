import {
	confirmDialog,
	installConsole,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The event page header: date, venue and publish state, 公開する for a draft
 * and an overflow menu with 中止する and 公演を編集, the fan page address of
 * a published date of a PUBLIC concert, and the tab addresses.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'
const TOKENS = 'components/infrastructure/organizer/web/global/design-tokens'
const SNACK = 'components/infrastructure/organizer/web/global/snack-bar'

/** The fan origin of the e2e config's environment (`dev`). */
const FAN_PAGE = 'https://dev.liverty-music.app/events/e-1103'

/** XX Tour 2026 with its 3 November date still a draft. */
function tourWithDraft(state: 'DRAFT' | 'PUBLISHED'): ConcertSpec {
	return {
		...XX_TOUR,
		events: XX_TOUR.events.map((e) =>
			e.id === 'e-1103' ? { ...e, state } : e,
		),
	}
}

function rpc(concert: ConcertSpec): RpcMocks {
	return {
		'SeriesService/List': seriesList([concert]),
		'OrganizerService/Get': organizer(),
		'PayoutAccountService/Get': payoutAccount('ACTIVE'),
		'TicketSaleService/ListByEvent': salesOf('e-1103', []),
		'ScannerService/ListByEvent': { scanners: [] },
	}
}

const header = (page: Page) => page.locator('event-route header.header')
const actions = (page: Page) =>
	page.locator('event-route header.header .actions')
const menuButton = (page: Page) =>
	actions(page).getByRole('button', { name: 'その他の操作' })
const menu = (page: Page) => page.getByRole('menu', { name: 'その他の操作' })
const fanPage = (page: Page) =>
	page.locator('event-route copy-field').filter({ hasText: 'ファンページ' })

/** Stubs the clipboard and returns what was written to it. */
async function spyClipboard(page: Page): Promise<() => Promise<string[]>> {
	await page.addInitScript(() => {
		const written: string[] = []
		;(window as unknown as { __clipboard: string[] }).__clipboard = written
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					written.push(text)
				},
			},
		})
	})
	return () =>
		page.evaluate(
			() => (window as unknown as { __clipboard: string[] }).__clipboard,
		)
}

test.describe('the event header', () => {
	test(`@spec ${SPEC} "Draft event"`, async ({ page }) => {
		await installConsole(page, {
			rpc: rpc(tourWithDraft('DRAFT')),
			language: 'ja',
		})
		await page.goto(`${SERIES}/s-tour/events/e-1103`)

		await expect(
			page.getByRole('heading', { level: 1, name: '11月3日(火) 18:00 JST' }),
		).toBeVisible()
		await expect(header(page)).toContainText('XX Tour 2026')
		await expect(header(page)).toContainText('Zepp Haneda')
		await expect(header(page).locator('status-badge')).toHaveText('下書き')
		// 公開する is the page's one filled action.
		await expect(
			actions(page)
				.locator('console-button')
				.filter({ has: page.locator('[data-variant="filled"]') }),
		).toHaveText([/公開する/])
		await expect(
			actions(page).getByRole('button', { name: '中止する' }),
		).toHaveCount(0)
		// 中止する and 公演を編集 are in the header's menu.
		await menuButton(page).click()
		await expect(menu(page).getByRole('menuitem')).toHaveText([
			'中止する',
			'公演を編集',
		])
		await expect(
			menu(page).getByRole('menuitem', { name: '公演を編集' }),
		).toHaveAttribute('href', /\/series\/s-tour\/edit$/)
		// Cancelling a draft date removes it, and the dialog says so.
		await menu(page).getByRole('menuitem', { name: '中止する' }).click()
		await expect(menu(page)).toBeHidden()
		const cancel = confirmDialog(page, {
			name: 'XX Tour 2026 のこの公演日を中止しますか？',
		})
		await expect(cancel).toContainText('下書きの公演日は削除されます')
		await cancel.getByRole('button', { name: 'やめる' }).click()
		// Focus returns to the menu's button.
		await expect(menuButton(page)).toBeFocused()
		// A draft date has no fan page.
		await expect(fanPage(page)).toHaveCount(0)
		// The page opens on 販売.
		await expect(page).toHaveURL(/\/events\/e-1103\/ticket-sales$/)
		await expect(
			page.getByRole('link', { name: '販売', exact: true }),
		).toHaveAttribute('aria-current', 'page')
	})

	test(`@spec ${SPEC} "Publish confirmed"`, async ({ page }) => {
		const mocks = rpc(tourWithDraft('DRAFT'))
		// PublishResponse carries the one series (not a list) with its dates.
		const published = seriesList([tourWithDraft('PUBLISHED')]) as {
			series: unknown[]
		}
		mocks['SeriesService/Publish'] = {
			...published,
			series: published.series[0],
		}
		const log = await installConsole(page, { rpc: mocks, language: 'ja' })
		await page.goto(`${SERIES}/s-tour/events/e-1103/ticket-sales`)

		await actions(page).getByRole('button', { name: '公開する' }).click()
		const dialog = confirmDialog(page, {
			name: 'XX Tour 2026 のこの公演日を公開しますか？',
		})
		await expect(dialog).toBeVisible()
		// It publishes this date alone and points to the concert page for several.
		await expect(dialog).toContainText('この公演日だけを公開し')
		await expect(dialog).toContainText('出演者のフォロワーに通知します')
		await expect(dialog).toContainText('公演ページから公開してください')
		await dialog.getByRole('button', { name: '公開する' }).click()

		await expect(header(page).locator('status-badge')).toHaveText('公開中')
		await expect(
			page.getByRole('status').filter({ hasText: '公開しました' }),
		).toBeVisible()
		await expect(
			actions(page).getByRole('button', { name: '公開する' }),
		).toHaveCount(0)
		const publish = log.calls.find((c) => c.method === 'SeriesService/Publish')
		expect(publish?.body).toEqual({
			seriesId: { value: 's-tour' },
			eventIds: [{ value: 'e-1103' }],
		})
	})

	test(`@spec ${SPEC} "Reception tab address"`, async ({ page }) => {
		await installConsole(page, { rpc: rpc(XX_TOUR), language: 'ja' })
		await page.goto(`${SERIES}/s-tour/events/e-1103/scanners`)

		await expect(
			page.getByRole('heading', { level: 1, name: '11月3日(火) 18:00 JST' }),
		).toBeVisible()
		await expect(
			page.getByRole('link', { name: '受付', exact: true }),
		).toHaveAttribute('aria-current', 'page')
		await expect(
			page.getByRole('link', { name: '販売', exact: true }),
		).not.toHaveAttribute('aria-current', 'page')
		await expect(
			page.getByRole('button', { name: '受付リンクを発行' }),
		).toBeVisible()
	})
})

test.describe('the fan page of a published date', () => {
	test(`@spec ${SPEC} "Public date"`, async ({ page }) => {
		const clipboard = await spyClipboard(page)
		await installConsole(page, { rpc: rpc(XX_TOUR), language: 'ja' })
		await page.goto(`${SERIES}/s-tour/events/e-1103/ticket-sales`)

		await expect(fanPage(page)).toContainText(FAN_PAGE)
		await fanPage(page)
			.getByRole('button', { name: 'ファンページをコピー' })
			.click()
		expect(await clipboard()).toEqual([FAN_PAGE])
		await expect(
			page.getByRole('status').filter({ hasText: 'コピーしました' }),
		).toBeVisible()
	})

	test(`@spec ${SPEC} "Unlisted concert"`, async ({ page }) => {
		await installConsole(page, {
			rpc: rpc({ ...XX_TOUR, visibility: 'UNLISTED', state: 'PUBLISHED' }),
			language: 'ja',
		})
		await page.goto(`${SERIES}/s-tour/events/e-1103/ticket-sales`)
		await expect(header(page).locator('status-badge')).toHaveText('公開中')
		await expect(fanPage(page)).toHaveCount(0)
		await expect(page.getByText('/events/e-1103')).toHaveCount(0)
	})

	test(`@spec ${SNACK} "Two results in a row"`, async ({ page }) => {
		await spyClipboard(page)
		const mocks = rpc(tourWithDraft('DRAFT'))
		const published = seriesList([tourWithDraft('PUBLISHED')]) as {
			series: unknown[]
		}
		mocks['SeriesService/Publish'] = {
			...published,
			series: published.series[0],
		}
		await installConsole(page, { rpc: mocks, language: 'ja' })
		await page.goto(`${SERIES}/s-tour/events/e-1103/ticket-sales`)

		await actions(page).getByRole('button', { name: '公開する' }).click()
		await confirmDialog(page).getByRole('button', { name: '公開する' }).click()
		const snacks = page.locator('.snack-item:popover-open')
		await expect(snacks).toHaveText([/公開しました/])

		// Copying the fan page address right after replaces the message.
		await fanPage(page)
			.getByRole('button', { name: 'ファンページをコピー' })
			.click()
		await expect(snacks).toHaveText([/コピーしました/])
	})
})

test.describe('type scale', () => {
	test(`@spec ${TOKENS} "Same size on PC and phone"`, async ({ page }) => {
		await installConsole(page, { rpc: rpc(XX_TOUR), language: 'ja' })
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 })
			await page.goto(`${SERIES}/s-tour/events/e-1103/ticket-sales`)

			const title = page.getByRole('heading', { level: 1 })
			await expect(title).toHaveText('11月3日(火) 18:00 JST')
			await expect(title, `title at ${width} px`).toHaveCSS('font-size', '24px')
			for (const body of [
				page.locator('event-route .venue'),
				page.getByText('この公演日の販売はまだありません。'),
				page.locator('body'),
			]) {
				await expect(body, `body text at ${width} px`).toHaveCSS(
					'font-size',
					'14px',
				)
			}
		}
	})
})
