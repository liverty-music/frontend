import {
	connectError,
	installConsole,
	ORG,
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
import { expect, type Locator, type Page, test } from '../support/test'

/**
 * Home: what needs the member now, most urgent first, as one list grouped
 * by kind under subheaders; each item is one link to where it is resolved,
 * labelled with what to do there, and holds no other control.
 */

const SPEC = 'components/infrastructure/organizer/web/route/home'

/** Wednesday 28 October 2026, 10:00 JST: XX Tour's 3 November date is next week. */
const NOW = new Date('2026-10-28T10:00:00+09:00')

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([]),
	'OrganizerService/Get': organizer(),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ScannerService/ListByEvent': { scanners: [] },
}

async function openHome(page: Page, rpc: RpcMocks, now = NOW) {
	await page.clock.setFixedTime(now)
	const log = await installConsole(page, {
		rpc: { ...BASE, ...rpc },
		language: 'ja',
	})
	await page.goto(ORG)
	await expect(
		page.getByRole('heading', { level: 1, name: 'ホーム' }),
	).toBeVisible()
	return log
}

const region = (page: Page) =>
	page.getByRole('region', { name: '対応が必要なこと' })

const items = (page: Page) => region(page).getByRole('listitem')

/** The items under one subheader (要対応, 7日以内, 開始時刻なし, 下書き). */
const group = (page: Page, subheader: string) =>
	region(page).getByRole('list', { name: subheader }).getByRole('listitem')

/** An item is one link, with no button or other control inside it. */
async function expectSingleAction(item: Locator): Promise<Locator> {
	await expect(item.getByRole('link')).toHaveCount(1)
	await expect(item.getByRole('button')).toHaveCount(0)
	return item.getByRole('link')
}

test.describe('what needs the member', () => {
	test(`@spec ${SPEC} "Payout account not finished"`, async ({ page }) => {
		await openHome(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
			'SeriesService/List': seriesList([XX_TOUR, XX_SOLO]),
		})
		await expect(items(page)).not.toHaveCount(0)
		const first = items(page).first()
		await expect(group(page, '要対応')).toHaveCount(1)
		await expect(first).toContainText('入金口座の登録が終わっていません')
		const action = await expectSingleAction(first)
		await expect(action).toHaveAccessibleName(
			/^入金口座の登録が終わっていません\s*登録する$/,
		)
		await expect(action).toHaveAttribute('href', /\/settings#payout$/)
		// The scanner item and the draft concert follow, under their subheaders.
		await expect(items(page)).toHaveCount(3)
		await expect(region(page).getByRole('heading')).toHaveText([
			'要対応',
			'7日以内',
			'下書き',
		])
		await expect(group(page, '7日以内')).toContainText('受付リンクなし')
		await expect(group(page, '下書き')).toContainText('XX 単独公演')
	})

	test(`@spec ${SPEC} "No payout account yet"`, async ({ page }) => {
		await openHome(page, {
			'PayoutAccountService/Get': () =>
				connectError('not_found', 'no payout account', 404),
			'SeriesService/List': seriesList([XX_SOLO]),
		})
		const first = items(page).first()
		await expect(first).toContainText('入金口座の登録が終わっていません')
		const action = await expectSingleAction(first)
		await expect(action).toHaveAccessibleName(
			/^入金口座の登録が終わっていません\s*登録する$/,
		)
		await expect(action).toHaveAttribute('href', /\/settings#payout$/)
		await expect(
			page.getByText('入金口座の状況を読み込めませんでした。'),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Event next week without a scanner"`, async ({
		page,
	}) => {
		const log = await openHome(page, {
			'SeriesService/List': seriesList([XX_TOUR]),
		})
		const item = group(page, '7日以内')
		await expect(item).toHaveCount(1)
		await expect(item).toContainText('11月3日(火) 18:00 JST · 受付リンクなし')
		await expect(item).toContainText('XX Tour 2026')
		await expectSingleAction(item)
		await expect(item).toContainText('発行する')
		expect(
			log.calls.some(
				(c) =>
					c.method === 'ScannerService/ListByEvent' &&
					JSON.stringify(c.body).includes('e-1103'),
			),
		).toBe(true)

		await item.getByRole('link').click()
		await expect(page).toHaveURL(/\/series\/s-tour\/events\/e-1103\/scanners$/)
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
		const item = group(page, '7日以内')
		await expect(item).toContainText('11月3日(火) 18:00 JST · 受付リンクなし')
		await expect(item.getByRole('link', { name: /発行する/ })).toHaveAttribute(
			'href',
			/\/series\/s-tour\/events\/e-1103\/scanners$/,
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
		const item = group(page, '開始時刻なし').first()
		await expect(item).toContainText('XX Tour 2026')
		await expect(item).toContainText('12月20日(日)')
		await expect(item).toContainText('開始時刻が未設定です')
		await expectSingleAction(item)
		await expect(item).toContainText('設定する')

		// The action opens XX Tour 2026's concert editor (asserted by its
		// address: the editor screen itself is covered by its own spec).
		await expect(item.getByRole('link', { name: /設定する/ })).toHaveAttribute(
			'href',
			/\/series\/s-tour\/edit$/,
		)
	})

	test(`@spec ${SPEC} "Draft concert"`, async ({ page }) => {
		await openHome(page, {
			'SeriesService/List': seriesList([XX_SOLO]),
		})
		await expect(items(page)).toHaveCount(1)
		const item = group(page, '下書き').first()
		const link = await expectSingleAction(item)
		await expect(link).toHaveAccessibleName(/^XX 単独公演\s*12月20日\(日\)$/)
		await expect(link).toHaveAttribute('href', /\/series\/s-solo$/)
		await link.click()
		await expect(
			page.getByRole('heading', { level: 1, name: 'XX 単独公演' }),
		).toBeVisible()
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
		await expect(region(page)).toHaveCount(0)
		const link = page.getByRole('link', { name: '公演一覧へ' })
		await expect(link).toHaveAttribute('href', /\/series$/)
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
		await expect(group(page, '下書き').first()).toContainText('XX 単独公演')
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
