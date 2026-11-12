import {
	confirmDialog,
	installConsole,
	type RpcMocks,
	SERIES,
} from '../support/organizer'
import {
	type ConcertSpec,
	jst,
	organizer,
	payoutAccount,
	salesOf,
	seriesList,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * One concert in the real console: the summary beside the event dates from
 * 840 px and below them on narrower windows, a date opening its event page,
 * and the snack a cancelled draft concert leaves on the concerts list. What
 * the dates, the header, the publish and cancel dialogs and the seat types
 * say and send is checked against the rendered route in
 * `test/organizer/concert/concert-page.spec.ts`.
 */

const SPEC = 'components/infrastructure/organizer/web/route/concert'

const NOW = new Date('2026-10-28T10:00:00+09:00')

/** XX Tour 2026 with three dates, listed by the server out of date order. */
const TOUR_OF_THREE: ConcertSpec = {
	...XX_TOUR,
	events: [XX_TOUR.events[2], XX_TOUR.events[0], XX_TOUR.events[1]],
}

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([TOUR_OF_THREE]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
	'TicketSaleService/ListByEvent': (body) => ({
		body: JSON.stringify(body).includes('e-1103')
			? salesOf('e-1103', [
					{
						id: 'sale-1',
						name: '最速先行',
						method: 'LOTTERY',
						start: jst('2026-10-20', '12:00'),
						end: jst('2026-11-01', '23:59'),
					},
				])
			: salesOf('none', []),
	}),
}

async function openConcert(page: Page, path: string, rpc: RpcMocks = BASE) {
	await page.clock.setFixedTime(NOW)
	const log = await installConsole(page, { rpc, language: 'ja' })
	await page.goto(path)
	return log
}

test.describe('summary and event dates', () => {
	// What the dates and the summary say is checked against the rendered route in
	// test/organizer/concert/concert-page.spec.ts; the browser decides where the
	// summary sits and what a click on a date does.
	test(`@spec ${SPEC} "Tour with three dates"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcert(page, `${SERIES}/s-tour`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()

		const dates = page
			.getByRole('list', { name: '公演日' })
			.getByRole('listitem')
		await expect(dates).toHaveCount(3)

		// The summary sits beside the dates on a 1280 px window.
		const summary = page.getByRole('complementary', { name: '概要' })
		const list = await page.getByRole('list', { name: '公演日' }).boundingBox()
		const aside = await summary.boundingBox()
		expect(aside?.x).toBeGreaterThan((list?.x ?? 0) + (list?.width ?? 0) - 1)

		await dates.nth(0).getByRole('link').click()
		await expect(page).toHaveURL(
			/\/series\/s-tour\/events\/e-1103(\/ticket-sales)?$/,
		)
	})

	test('The summary goes below the dates on a phone', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await openConcert(page, `${SERIES}/s-tour`)
		const list = await page.getByRole('list', { name: '公演日' }).boundingBox()
		const aside = await page
			.getByRole('complementary', { name: '概要' })
			.boundingBox()
		expect(aside?.y).toBeGreaterThan((list?.y ?? 0) + (list?.height ?? 0) - 1)
	})
})

/**
 * A small concert server: Publish publishes the named DRAFT dates and Cancel
 * cancels every date, so the page reads what the action did.
 */
function concertServer(concert: ConcertSpec) {
	const state: ConcertSpec = structuredClone(concert)
	const body = () => seriesList([state])
	const rpc: RpcMocks = {
		...BASE,
		'SeriesService/List': () => ({ body: body() }),
		'SeriesService/Publish': (req) => {
			const ids = ((req.eventIds ?? []) as Array<{ value: string }>).map(
				(e) => e.value,
			)
			for (const e of state.events) {
				if (e.state === 'DRAFT' && (ids.length === 0 || ids.includes(e.id))) {
					e.state = 'PUBLISHED'
				}
			}
			const b = body()
			return { body: { ...b, series: (b.series as unknown[])[0] } }
		},
		'SeriesService/Cancel': () => {
			state.events = state.events
				.filter((e) => e.state !== 'DRAFT')
				.map((e) => ({ ...e, state: 'CANCELLED' as const }))
			return { body: {} }
		},
	}
	return { rpc, state }
}

const _DRAFT_TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({ ...e, state: 'DRAFT' as const })),
}

const DRAFT_TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({ ...e, state: 'DRAFT' as const })),
}

test('a snack shown on the concerts list sits above the floating button', async ({
	page,
}) => {
	// @spec components/infrastructure/organizer/web/global/snack-bar "A snack does not cover the floating button"
	// Removing a concert of drafts only returns to the list with a snack,
	// where the extended FAB floats at the bottom of a phone window.
	await page.setViewportSize({ width: 390, height: 844 })
	await openConcert(page, `${SERIES}/s-tour`, concertServer(DRAFT_TOUR).rpc)
	await page
		.locator('concert-route header')
		.getByRole('button', { name: 'その他の操作' })
		.click()
	await page.getByRole('menuitem', { name: '公演を中止' }).click()
	await confirmDialog(page).getByRole('button', { name: '公演を中止' }).click()

	const snack = page.locator('.snack-surface')
	await expect(snack).toContainText('下書きの公演を削除しました')
	const fab = page.locator('extended-fab')
	await expect(fab).toBeVisible()
	const fabBox = await fab.boundingBox()
	if (!fabBox) throw new Error('no FAB box')
	// The snack rises into place; its settled bottom edge clears the FAB.
	await expect
		.poll(async () => {
			const box = await snack.boundingBox()
			return box ? fabBox.y - (box.y + box.height) : -1
		})
		.toBeGreaterThanOrEqual(0)
})
