import {
	confirmDialog,
	installConsole,
	type RpcMocks,
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
 * One concert: its summary, the share link of a published UNLISTED concert,
 * and its event dates, each opening its event page.
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
	'ArtistService/List': { artists: [] },
	'TicketSaleService/ListByEvent': (body) => ({
		body: JSON.stringify(body).includes('e-1103')
			? salesOf('e-1103', [
					{
						id: 'sale-1',
						name: '最速先行',
						method: 'LOTTERY',
						start: jst('2026-10-20', '12:00'),
						end: jst('2026-11-01', '23:59'),
						price: 6800,
						quantity: 1000,
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
	test(`@spec ${SPEC} "Tour with three dates"`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await openConcert(page, '/concerts/s-tour')
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()

		const table = page.getByRole('table', { name: '公演日' })
		const rows = table.getByRole('rowgroup').nth(1).getByRole('row')
		await expect(rows).toHaveCount(3)
		await expect(rows.nth(0)).toContainText('11月3日(火) 18:00 JST')
		await expect(rows.nth(0)).toContainText('Zepp Haneda')
		await expect(rows.nth(0)).toContainText('受付中')
		await expect(rows.nth(0)).toContainText('公開中')
		await expect(rows.nth(1)).toContainText('11月10日(火) 18:00 JST')
		await expect(rows.nth(1)).toContainText('Zepp Osaka Bayside')
		await expect(rows.nth(1)).toContainText('販売なし')
		await expect(rows.nth(1)).toContainText('公開中')
		await expect(rows.nth(2)).toContainText('11月17日(火) 18:00 JST')
		await expect(rows.nth(2)).toContainText('Zepp Nagoya')
		await expect(rows.nth(2)).toContainText('公開中')

		await rows
			.nth(0)
			.getByRole('link', { name: '11月3日(火) 18:00 JST' })
			.click()
		await expect(page).toHaveURL(
			/\/concerts\/s-tour\/events\/e-1103(\/sales)?$/,
		)
	})

	test(`@spec ${SPEC} "Unknown concert"`, async ({ page }) => {
		await openConcert(page, '/concerts/s-other')
		await expect(
			page.getByRole('heading', { level: 1, name: '公演が見つかりません' }),
		).toBeVisible()
		const back = page
			.getByRole('main')
			.getByRole('link', { name: '公演一覧へ' })
		await expect(back).toHaveAttribute('href', /\/concerts$/)
		await back.click()
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()
	})
})

test.describe('share link', () => {
	const UNLISTED: ConcertSpec = {
		...TOUR_OF_THREE,
		visibility: 'UNLISTED',
		state: 'PUBLISHED',
	}
	const NEW_LINK = 'https://liverty-music.app/s/new-share-token'

	test(`@spec ${SPEC} "New share link"`, async ({ page }) => {
		const log = await openConcert(page, '/concerts/s-tour', {
			...BASE,
			'SeriesService/List': seriesList([UNLISTED]),
			'SeriesService/RegenerateShareUrl': { shareUrl: { value: NEW_LINK } },
		})
		await expect(
			page.getByText('限定公開の公演は、共有リンクからだけ開けます。', {
				exact: false,
			}),
		).toBeVisible()

		await page.getByRole('button', { name: '新しい共有リンクを発行' }).click()
		const dialog = confirmDialog(page, {
			name: '新しい共有リンクを発行しますか？',
		})
		await expect(dialog).toBeVisible()
		await expect(dialog).toContainText(
			'これまでの共有リンクは使えなくなります。',
		)
		// Nothing is rotated before the operator confirms.
		expect(
			log.calls.some((c) => c.method === 'SeriesService/RegenerateShareUrl'),
		).toBe(false)

		await dialog.getByRole('button', { name: '新しい共有リンクを発行' }).click()
		await expect(dialog).toBeHidden()

		await expect(page.getByText(NEW_LINK)).toBeVisible()
		await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible()
		// The server rotates the token, so the previous link stops opening the
		// concert; the console's part is asking it to.
		const calls = log.calls.filter(
			(c) => c.method === 'SeriesService/RegenerateShareUrl',
		)
		expect(calls).toHaveLength(1)
		expect(calls[0].body).toEqual({ seriesId: { value: 's-tour' } })
	})

	test(`@spec ${SPEC} "Public concert"`, async ({ page }) => {
		await openConcert(page, '/concerts/s-tour', {
			...BASE,
			'SeriesService/List': seriesList([
				{ ...TOUR_OF_THREE, visibility: 'PUBLIC', state: 'PUBLISHED' },
			]),
		})
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()
		await expect(
			page
				.getByRole('table', { name: '公演日' })
				.or(page.getByRole('list', { name: '公演日' })),
		).toBeAttached()
		await expect(
			page.getByRole('button', { name: '新しい共有リンクを発行' }),
		).toHaveCount(0)
		await expect(page.getByRole('heading', { name: '共有リンク' })).toHaveCount(
			0,
		)
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

const DRAFT_TOUR: ConcertSpec = {
	...XX_TOUR,
	events: XX_TOUR.events.map((e) => ({ ...e, state: 'DRAFT' as const })),
}

const publishDialog = (page: Page) =>
	confirmDialog(page, { name: 'XX Tour 2026 の公演日を公開しますか？' })

const badges = (page: Page) =>
	page.locator('data-list table tbody tr td:last-child status-badge')

test.describe('publish or cancel the dates together', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
	})

	test(`@spec ${SPEC} "New tour published at once"`, async ({ page }) => {
		const server = concertServer(DRAFT_TOUR)
		const log = await openConcert(page, '/concerts/s-tour', server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()

		const dialog = publishDialog(page)
		await expect(dialog.getByRole('checkbox')).toHaveCount(4)
		for (const box of await dialog.getByRole('checkbox').all()) {
			await expect(box).toBeChecked()
		}
		await expect(dialog).toContainText('出演者のフォロワーに1回通知します')
		await dialog.getByRole('button', { name: '公開する' }).click()

		const publishes = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publishes).toHaveLength(1)
		expect(publishes[0].body.eventIds).toEqual(
			['e-1103', 'e-1110', 'e-1117', 'e-1124'].map((value) => ({ value })),
		)
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'公開中',
		])
		await expect(page.locator('.snack-item')).toContainText(
			'4件の公演日を公開しました',
		)
	})

	test(`@spec ${SPEC} "Additional date on a published tour"`, async ({
		page,
	}) => {
		const withAddition: ConcertSpec = {
			...XX_TOUR,
			events: XX_TOUR.events.map((e, i) =>
				i === 3 ? { ...e, state: 'DRAFT' as const } : e,
			),
		}
		const server = concertServer(withAddition)
		const log = await openConcert(page, '/concerts/s-tour', server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()
		const dialog = publishDialog(page)
		await expect(dialog.getByRole('checkbox')).toHaveCount(1)
		await dialog.getByRole('button', { name: '公開する' }).click()

		const [publish] = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publish.body.eventIds).toEqual([{ value: 'e-1124' }])
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'公開中',
		])
	})

	test(`@spec ${SPEC} "One date left out"`, async ({ page }) => {
		const server = concertServer(DRAFT_TOUR)
		const log = await openConcert(page, '/concerts/s-tour', server.rpc)
		await page.getByRole('button', { name: '公開する', exact: true }).click()
		const dialog = publishDialog(page)
		await dialog.getByRole('checkbox', { name: /11月24日/ }).uncheck()
		await dialog.getByRole('button', { name: '公開する' }).click()

		const [publish] = log.calls.filter(
			(c) => c.method === 'SeriesService/Publish',
		)
		expect(publish.body.eventIds).toEqual(
			['e-1103', 'e-1110', 'e-1117'].map((value) => ({ value })),
		)
		await expect(badges(page)).toHaveText([
			'公開中',
			'公開中',
			'公開中',
			'下書き',
		])
	})

	test(`@spec ${SPEC} "Whole concert cancelled"`, async ({ page }) => {
		const server = concertServer(XX_TOUR)
		const log = await openConcert(page, '/concerts/s-tour', server.rpc)
		await page.getByRole('button', { name: '公演を中止' }).click()
		const dialog = confirmDialog(page, {
			name: 'XX Tour 2026 を中止しますか？',
		})
		await expect(dialog).toContainText('ファンに1回知らされます')
		await dialog.getByRole('button', { name: '公演を中止' }).click()

		const cancels = log.calls.filter((c) => c.method === 'SeriesService/Cancel')
		expect(cancels).toHaveLength(1)
		expect(cancels[0].body.eventIds ?? []).toEqual([])
		await expect(badges(page)).toHaveText(['中止', '中止', '中止', '中止'])
	})

	test(`@spec ${SPEC} "Nothing to publish"`, async ({ page }) => {
		await openConcert(page, '/concerts/s-tour', concertServer(XX_TOUR).rpc)
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX Tour 2026' }),
		).toBeVisible()
		await expect(
			page.getByRole('button', { name: '公開する', exact: true }),
		).toHaveCount(0)
	})
})
