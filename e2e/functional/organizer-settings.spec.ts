import { installConsole, type RpcMocks } from '../support/organizer'
import { organizer, payoutAccount, seriesList } from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Settings: the Organizer's name and represented Artists, its business
 * details and its payout account status, all read only.
 */

const SPEC = 'components/infrastructure/organizer/web/route/settings'

const artists = (...names: string[]) => ({
	artists: names.map((name, i) => ({
		id: { value: `a-${i + 1}` },
		name: { value: name },
	})),
})

const BASE: RpcMocks = {
	'SeriesService/List': seriesList([]),
	'OrganizerService/Get': organizer('XX Records'),
	'PayoutAccountService/Get': payoutAccount('ACTIVE'),
	'ArtistService/List': artists('Band A', 'Band B'),
}

async function openSettings(page: Page, rpc: RpcMocks = {}) {
	const log = await installConsole(page, {
		rpc: { ...BASE, ...rpc },
		language: 'ja',
	})
	await page.goto('/settings')
	await expect(
		page.getByRole('heading', { level: 1, name: '設定' }),
	).toBeVisible()
	return log
}

const part = (page: Page, heading: string) =>
	page.getByRole('region', { name: heading, exact: true })

/** The value shown for a business detail term. */
const detail = (page: Page, term: string) =>
	part(page, '事業者情報')
		.getByRole('term')
		.filter({ hasText: term })
		.locator('xpath=following-sibling::dd[1]')

test.describe('organization', () => {
	test(`@spec ${SPEC} "Two represented Artists"`, async ({ page }) => {
		await openSettings(page)
		const organization = part(page, '組織')
		await expect(organization).toContainText('XX Records')
		await expect(organization.getByRole('listitem')).toHaveText([
			'Band A',
			'Band B',
		])
		await expect(organization).toContainText('Liverty Music が承ります')
		// Read only: nothing to edit.
		await expect(organization.getByRole('textbox')).toHaveCount(0)
	})
})

test.describe('business details', () => {
	test(`@spec ${SPEC} "Complete details"`, async ({ page }) => {
		await openSettings(page)
		const business = part(page, '事業者情報')
		await expect(detail(page, '事業者名')).toHaveText('株式会社エックス')
		await expect(detail(page, '代表者名')).toHaveText('山田 太郎')
		await expect(detail(page, '所在地')).toHaveText('東京都渋谷区神南1-1-1')
		await expect(detail(page, '電話番号')).toHaveText('03-0000-0000')
		await expect(detail(page, '連絡先メールアドレス')).toHaveText(
			'info@example.com',
		)
		await expect(business).toContainText('特定商取引法に基づく表記')
		await expect(business).not.toContainText('未登録')
		await expect(business).not.toContainText('販売は始められません')
	})

	test(`@spec ${SPEC} "Address missing"`, async ({ page }) => {
		await openSettings(page, {
			'OrganizerService/Get': organizer('XX Records', ['businessAddress']),
		})
		await expect(detail(page, '所在地')).toHaveText('未登録')
		await expect(detail(page, '事業者名')).toHaveText('株式会社エックス')
		await expect(part(page, '事業者情報')).toContainText(
			'すべての事業者情報が登録されるまで、販売は始められません。',
		)
	})
})

test.describe('payout account', () => {
	test(`@spec ${SPEC} "Onboarding not finished"`, async ({ page }) => {
		await openSettings(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
		})
		const payout = part(page, '入金口座')
		await expect(payout.getByTestId('payout-status')).toHaveText('確認中')
		await expect(payout).toContainText('ファンはチケットを購入できます')
		const proceed = payout.getByRole('link', { name: '登録を続ける' })
		await expect(proceed).toHaveAttribute(
			'href',
			'https://connect.example.com/onboarding',
		)
		await expect(proceed).toHaveAttribute('target', '_blank')
	})

	test(`@spec ${SPEC} "Back from onboarding"`, async ({ page }) => {
		let status: 'PENDING' | 'ACTIVE' = 'PENDING'
		const log = await openSettings(page, {
			'PayoutAccountService/Get': () => ({ body: payoutAccount(status) }),
		})
		const payout = part(page, '入金口座')
		await expect(payout.getByTestId('payout-status')).toHaveText('確認中')
		const readsBefore = log.calls.filter(
			(c) => c.method === 'PayoutAccountService/Get',
		).length

		// Onboarding finishes in the other tab; the operator returns to this one.
		status = 'ACTIVE'
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				value: 'visible',
				configurable: true,
			})
			document.dispatchEvent(new Event('visibilitychange'))
		})

		await expect(payout.getByTestId('payout-status')).toHaveText('有効')
		expect(
			log.calls.filter((c) => c.method === 'PayoutAccountService/Get').length,
		).toBeGreaterThan(readsBefore)
		await expect(
			payout.getByRole('link', { name: '登録を続ける' }),
		).toHaveCount(0)
	})

	test(`@spec ${SPEC} "Active account"`, async ({ page }) => {
		await openSettings(page)
		const payout = part(page, '入金口座')
		await expect(payout.getByTestId('payout-status')).toHaveText('有効')
		await expect(
			payout.getByRole('link', { name: '登録を続ける' }),
		).toHaveCount(0)
		await expect(payout).not.toContainText('ファンはチケットを購入できます')
	})
})
