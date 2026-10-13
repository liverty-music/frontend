import {
	connectError,
	installConsole,
	type RpcMocks,
} from '../support/organizer'
import {
	type ConcertSpec,
	organizer,
	payoutAccount,
	scanner,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Home: what needs the operator now, most urgent first, each with the one
 * action that resolves it.
 */

const SPEC = 'components/infrastructure/organizer/web/route/home'

/** Wednesday 28 October 2026, 10:00 JST: XX Tour's 3 November date is next week. */
const NOW = new Date('2026-10-28T10:00:00+09:00')

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
	'ArtistService/List': { artists: [] },
}

async function openHome(page: Page, rpc: RpcMocks, now = NOW) {
	await page.clock.setFixedTime(now)
	const log = await installConsole(page, {
		rpc: { ...BASE, ...rpc },
		language: 'ja',
	})
	await page.goto('/home')
	await expect(
		page.getByRole('heading', { level: 1, name: 'ホーム' }),
	).toBeVisible()
	return log
}

const items = (page: Page) =>
	page.getByRole('list', { name: '対応が必要なこと' }).getByRole('listitem')

test.describe('what needs the operator', () => {
	test(`@spec ${SPEC} "Payout account not finished"`, async ({ page }) => {
		await openHome(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
			'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
		})
		await expect(items(page)).not.toHaveCount(0)
		const first = items(page).first()
		await expect(first).toContainText('入金口座の登録が終わっていません')
		const action = first.getByRole('link', { name: '登録する' })
		await expect(action).toBeVisible()
		await expect(action).toHaveAttribute('href', /\/settings#payout$/)
		// The scanner item and the draft concert follow the payout item.
		await expect(items(page)).toHaveCount(3)
		await expect(items(page).nth(1)).toContainText('受付リンクなし')
		await expect(items(page).nth(2)).toContainText('下書き XX 単独公演')
	})

	test(`@spec ${SPEC} "Event next week without a scanner"`, async ({
		page,
	}) => {
		const log = await openHome(page, {
			'SeriesService/List': seriesList([XX_TOUR]),
		})
		const item = items(page).filter({ hasText: '受付リンクなし' })
		await expect(item).toHaveCount(1)
		await expect(item).toContainText('11月3日(火) 18:00 JST · 受付リンクなし')
		await expect(item).toContainText('XX Tour 2026')
		expect(
			log.calls.some(
				(c) =>
					c.method === 'ScannerService/ListByEvent' &&
					JSON.stringify(c.body).includes('e-1103'),
			),
		).toBe(true)

		await item.getByRole('link', { name: '発行する' }).click()
		await expect(page).toHaveURL(
			/\/concerts\/s-tour\/events\/e-1103\/reception$/,
		)
	})

	test(`@spec ${SPEC} "Revoked scanners only"`, async ({ page }) => {
		await openHome(page, {
			'SeriesService/List': seriesList([XX_TOUR]),
			'ScannerService/ListByEvent': {
				scanners: [
					scanner('e-1103', { id: 'sc-1', number: 1, status: 'REVOKED' }),
				],
			},
		})
		const item = items(page).filter({ hasText: '受付リンクなし' })
		await expect(item).toContainText('11月3日(火) 18:00 JST · 受付リンクなし')
		await expect(item.getByRole('link', { name: '発行する' })).toHaveAttribute(
			'href',
			/\/concerts\/s-tour\/events\/e-1103\/reception$/,
		)
	})

	test(`@spec ${SPEC} "Published event without a start time"`, async ({
		page,
	}) => {
		const tour: ConcertSpec = {
			...XX_TOUR,
			events: [
				...XX_TOUR.events,
				{
					id: 'e-1220',
					date: '2026-12-20',
					venue: 'Zepp Haneda',
					state: 'PUBLISHED',
				},
			],
		}
		await openHome(page, {
			'SeriesService/List': seriesList([tour]),
			// The event next week has a scanner, so only the start time is missing.
			'ScannerService/ListByEvent': {
				scanners: [
					scanner('e-1103', { id: 'sc-1', number: 1, status: 'UNUSED' }),
				],
			},
		})
		await expect(items(page)).toHaveCount(1)
		const item = items(page).first()
		await expect(item).toContainText('XX Tour 2026')
		await expect(item).toContainText('12月20日(日)')
		await expect(item).toContainText('開始時刻なし')

		// The action opens XX Tour 2026's concert editor (asserted by its
		// address: the editor screen itself is covered by its own spec).
		await expect(item.getByRole('link', { name: '設定する' })).toHaveAttribute(
			'href',
			/\/concerts\/s-tour\/edit$/,
		)
	})

	test(`@spec ${SPEC} "Draft concert"`, async ({ page }) => {
		await openHome(page, {
			'SeriesService/List': seriesList([XX_SOLO]),
		})
		await expect(items(page)).toHaveCount(1)
		const item = items(page).first()
		await expect(item).toContainText('下書き XX 単独公演 · 12月20日(日)')
		const open = item.getByRole('link', { name: '開く' })
		await expect(open).toHaveAttribute('href', /\/concerts\/s-solo$/)
	})
})

test.describe('nothing to do and failures', () => {
	test(`@spec ${SPEC} "All clear"`, async ({ page }) => {
		// Two weeks before the tour: no event within 7 days, nothing in draft.
		await openHome(
			page,
			{ 'SeriesService/List': seriesList([XX_TOUR]) },
			new Date('2026-10-13T10:00:00+09:00'),
		)
		await expect(
			page.getByText('いま対応が必要なことはありません。'),
		).toBeVisible()
		await expect(
			page.getByRole('list', { name: '対応が必要なこと' }),
		).toHaveCount(0)
		const link = page.getByRole('link', { name: '公演一覧へ' })
		await expect(link).toHaveAttribute('href', /\/concerts$/)
		await link.click()
		await expect(
			page.getByRole('heading', { level: 1, name: '公演' }),
		).toBeVisible()
	})

	test(`@spec ${SPEC} "Payout status unavailable"`, async ({ page }) => {
		let payoutReads = 0
		await openHome(page, {
			'SeriesService/List': seriesList([XX_SOLO]),
			'PayoutAccountService/Get': () => {
				payoutReads++
				return connectError('unavailable', 'payout provider down', 503)
			},
		})
		await expect(items(page).first()).toContainText(
			'下書き XX 単独公演 · 12月20日(日)',
		)
		const alert = page.getByRole('alert').filter({
			hasText: '入金口座の状況を読み込めませんでした。',
		})
		await expect(alert).toBeVisible()
		// It is not claimed that nothing needs attention.
		await expect(
			page.getByText('いま対応が必要なことはありません。'),
		).toHaveCount(0)

		const before = payoutReads
		await alert.getByRole('button', { name: '再試行' }).click()
		await expect.poll(() => payoutReads).toBeGreaterThan(before)
	})
})
