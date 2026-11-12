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
 * The event page in the real console: what only a browser and the real router
 * show. The header, publish, fan page and snackbar scenarios are checked
 * against the rendered route in `test/organizer/event/event-header.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'

/** XX Tour 2026 with its 3 November date still a draft. */
function tourWithDraft(): ConcertSpec {
	return {
		...XX_TOUR,
		events: XX_TOUR.events.map((e) =>
			e.id === 'e-1103' ? { ...e, state: 'DRAFT' } : e,
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

const actions = (page: Page) =>
	page.locator('event-route header.header .actions')
const menuButton = (page: Page) =>
	actions(page).getByRole('button', { name: 'その他の操作' })
const menu = (page: Page) => page.getByRole('menu', { name: 'その他の操作' })

test.describe('the event header', () => {
	test('opens on 販売, and focus returns to the menu button after the cancel dialog', async ({
		page,
	}) => {
		await installConsole(page, { rpc: rpc(tourWithDraft()), language: 'ja' })
		await page.goto(`${SERIES}/s-tour/events/e-1103`)

		// The address without a tab redirects to the Sales tab.
		await expect(page).toHaveURL(/\/events\/e-1103\/ticket-sales$/)
		await expect(
			page.getByRole('link', { name: '販売', exact: true }),
		).toHaveAttribute('aria-current', 'page')

		// The native popover menu closes and the dialog gives focus back to it.
		await menuButton(page).click()
		await menu(page).getByRole('menuitem', { name: '中止する' }).click()
		await expect(menu(page)).toBeHidden()
		await confirmDialog(page, {
			name: 'XX Tour 2026 のこの公演日を中止しますか？',
		})
			.getByRole('button', { name: 'やめる' })
			.click()
		await expect(menuButton(page)).toBeFocused()
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
