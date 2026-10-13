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
 * The event page header: date, venue and publish state with 公開する,
 * 中止する and 編集, and the tab addresses.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'
const TOKENS = 'components/infrastructure/organizer/web/global/design-tokens'

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
const actions = (page: Page) => page.locator('event-route .actions')

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
		await expect(
			actions(page).getByRole('button', { name: '公開する' }),
		).toBeVisible()
		await expect(
			actions(page).getByRole('button', { name: '中止する' }),
		).toBeVisible()
		await expect(
			actions(page).getByRole('link', { name: '編集' }),
		).toHaveAttribute('href', /\/series\/s-tour\/edit$/)
		// Cancelling a draft date removes it, and the dialog says so.
		await actions(page).getByRole('button', { name: '中止する' }).click()
		const cancel = confirmDialog(page, {
			name: 'XX Tour 2026 のこの公演日を中止しますか？',
		})
		await expect(cancel).toContainText('下書きの公演日は削除されます')
		await cancel.getByRole('button', { name: 'やめる' }).click()
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
