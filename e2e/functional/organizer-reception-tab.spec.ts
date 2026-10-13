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
	type ScannerSpec,
	salesOf,
	scanner,
	seriesList,
	XX_SOLO,
	XX_TOUR,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * The event page's Reception (受付) tab: one Scanner per device, issued with
 * one action, revoked and reissued, and the prerequisites for issuing.
 */

const SPEC = 'components/infrastructure/organizer/web/route/event'
const RECEPTION = '/concerts/s-tour/events/e-1103/reception'
const ORIGIN = 'https://reception.e2e.liverty-music.app'

function rpc(
	scanners: ScannerSpec[],
	concerts: ConcertSpec[] = [XX_TOUR],
): RpcMocks {
	return {
		'SeriesService/List': seriesList(concerts),
		'OrganizerService/Get': organizer(),
		'PayoutAccountService/Get': payoutAccount('ACTIVE'),
		'TicketSaleService/ListByEvent': salesOf('e-1103', []),
		'ScannerService/ListByEvent': {
			scanners: scanners.map((s) => scanner('e-1103', s)),
		},
		'ArtistService/List': { artists: [] },
	}
}

async function open(page: Page, mocks: RpcMocks, path = RECEPTION) {
	const log = await installConsole(page, { rpc: mocks, language: 'ja' })
	await page.goto(path)
	return log
}

const tab = (page: Page) => page.locator('reception-tab')
const row = (page: Page, n: number) => page.locator(`[data-scanner="${n}"]`)
const issueButton = (page: Page) =>
	tab(page).getByRole('button', { name: '受付リンクを発行' })

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

test.describe('scanners', () => {
	test(`@spec ${SPEC} "Issue two scanners"`, async ({ page }) => {
		const clipboard = await spyClipboard(page)
		let next = 1
		const mocks = rpc([])
		mocks['ScannerService/Create'] = () => {
			const n = next++
			return {
				body: {
					scanner: scanner('e-1103', {
						id: `scanner-${n}`,
						number: n,
						status: 'UNUSED',
						token: `token-${n}`,
					}),
				},
			}
		}
		const log = await open(page, mocks)

		await expect(tab(page)).toContainText('まだ受付リンクがありません')
		await expect(tab(page)).toContainText(
			'各リンクは、最初に開いた1台の端末でだけ使えます。',
		)
		await expect(
			tab(page).getByRole('link', { name: '受付の手順（スタッフ向け）' }),
		).toHaveAttribute('target', '_blank')

		await issueButton(page).click()
		await expect(row(page, 1)).toBeVisible()
		await issueButton(page).click()
		await expect(row(page, 2)).toBeVisible()

		const creates = log.calls.filter(
			(c) => c.method === 'ScannerService/Create',
		)
		expect(creates.map((c) => c.body)).toEqual([
			{ eventId: { value: 'e-1103' } },
			{ eventId: { value: 'e-1103' } },
		])
		for (const n of [1, 2]) {
			await expect(
				row(page, n).getByRole('heading', { name: `受付${n}` }),
			).toBeVisible()
			await expect(row(page, n).locator('status-badge')).toHaveText('未使用')
			// The token is in the fragment of a link on the reception origin.
			await expect(row(page, n)).toContainText(`${ORIGIN}/#token-${n}`)
			await expect(
				row(page, n).getByRole('button', { name: `受付${n}をコピー` }),
			).toBeVisible()
		}

		await row(page, 2).getByRole('button', { name: '受付2をコピー' }).click()
		expect(await clipboard()).toEqual([`${ORIGIN}/#token-2`])
	})

	test(`@spec ${SPEC} "Scanner opened by staff"`, async ({ page }) => {
		await open(
			page,
			rpc([
				{
					id: 'scanner-1',
					number: 1,
					status: 'IN_USE',
					token: 'token-1',
					bindTime: jst('2026-11-03', '14:10'),
				},
			]),
		)

		await expect(row(page, 1).locator('status-badge')).toHaveText('使用中')
		await expect(row(page, 1)).toContainText('14:10 JST')
		await expect(row(page, 1)).not.toContainText('token-1')
		await expect(
			row(page, 1).getByRole('button', { name: /をコピー$/ }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Staff changed phones"`, async ({ page }) => {
		const mocks = rpc([
			{
				id: 'scanner-1',
				number: 1,
				status: 'IN_USE',
				bindTime: jst('2026-11-03', '14:10'),
			},
			{ id: 'scanner-2', number: 2, status: 'UNUSED', token: 'token-2' },
		])
		mocks['ScannerService/Revoke'] = (body) => ({
			body: {
				scanner: scanner('e-1103', {
					id:
						(body.scannerId as { value: string } | undefined)?.value ??
						'scanner-1',
					number: 1,
					status: 'REVOKED',
				}),
			},
		})
		mocks['ScannerService/Create'] = {
			scanner: scanner('e-1103', {
				id: 'scanner-3',
				number: 3,
				status: 'UNUSED',
				token: 'token-3',
			}),
		}
		const log = await open(page, mocks)

		await row(page, 1).getByRole('button', { name: '取り消して再発行' }).click()
		const dialog = confirmDialog(page, {
			name: '受付1を取り消して再発行しますか？',
		})
		await expect(dialog).toBeVisible()
		await expect(dialog).toContainText(
			'受付1を使っている端末は使えなくなります。',
		)
		await dialog.getByRole('button', { name: '取り消して再発行' }).click()

		await expect(row(page, 1).locator('status-badge')).toHaveText(
			'取り消し済み',
		)
		await expect(row(page, 3).locator('status-badge')).toHaveText('未使用')
		await expect(row(page, 3)).toContainText(`${ORIGIN}/#token-3`)
		await expect(
			row(page, 3).getByRole('button', { name: '受付3をコピー' }),
		).toBeVisible()
		// A revoked Scanner offers no more actions.
		await expect(
			row(page, 1).getByRole('button', { name: '取り消す' }),
		).toHaveCount(0)
		expect(log.calls.map((c) => c.method)).toEqual(
			expect.arrayContaining([
				'ScannerService/Revoke',
				'ScannerService/Create',
			]),
		)
		const revoke = log.calls.findIndex(
			(c) => c.method === 'ScannerService/Revoke',
		)
		const create = log.calls.findIndex(
			(c) => c.method === 'ScannerService/Create',
		)
		expect(revoke).toBeLessThan(create)
	})
})

test.describe('prerequisites', () => {
	test(`@spec ${SPEC} "Unpublished event"`, async ({ page }) => {
		const log = await open(
			page,
			rpc([], [XX_SOLO]),
			'/concerts/s-solo/events/e-1220/reception',
		)

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', {
				name: '受付リンクを発行するには、公演を公開してください',
			}),
		).toBeVisible()
		await expect(
			callout.getByRole('button', { name: '公開する' }),
		).toBeVisible()
		await expect(issueButton(page)).toHaveCount(0)
		expect(
			log.calls.some((c) => c.method === 'ScannerService/ListByEvent'),
		).toBe(false)
	})

	test(`@spec ${SPEC} "Event without a start time"`, async ({ page }) => {
		const untimed: ConcertSpec = {
			...XX_TOUR,
			events: [{ ...XX_TOUR.events[0], start: undefined }],
		}
		await open(page, rpc([], [untimed]))

		const callout = tab(page).locator('prerequisite-callout')
		await expect(
			callout.getByRole('heading', { name: '開始時刻を設定してください' }),
		).toBeVisible()
		await expect(callout).toContainText(
			'受付リンクを発行するには、公演日の開始時刻が必要です。',
		)
		await expect(
			callout.getByRole('link', { name: '公演を編集' }),
		).toHaveAttribute('href', /\/concerts\/s-tour\/edit$/)
		await expect(issueButton(page)).toHaveCount(0)
	})
})
