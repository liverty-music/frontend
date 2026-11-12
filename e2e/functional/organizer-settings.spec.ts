import { installConsole, ORG, type RpcMocks } from '../support/organizer'
import { organizer, payoutAccount, seriesList } from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Settings across screens: what the route shows for given data is tested in
 * test/organizer/settings/settings-route.spec.ts; this file keeps the Home
 * link that opens Settings at the payout account, and the language switch.
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

const part = (page: Page, heading: string) =>
	page.getByRole('region', { name: heading, exact: true })

test.describe('payout account', () => {
	/** The onboarding action, marked as going to an external site. */
	const onboardingAction = (page: Page, label: string) =>
		part(page, '入金口座').getByRole('button', {
			name: new RegExp(`^${label}\\s*（外部サイトに移動します）$`),
		})

	test(`@spec ${SPEC} "Onboarding page expired"`, async ({ page }) => {
		await installConsole(page, {
			rpc: { ...BASE, 'PayoutAccountService/Get': payoutAccount('PENDING') },
			language: 'ja',
		})
		await page.goto('/')
		await page
			.getByRole('link', { name: /入金口座の登録が終わっていません/ })
			.click()

		await expect(page).toHaveURL(new RegExp(`${ORG}/settings#payout$`))
		await expect(onboardingAction(page, 'Stripe で登録を続ける')).toBeVisible()
	})
})

const I18N = 'components/infrastructure/organizer/web/global/i18n'

test.describe('language', () => {
	test(`@spec ${I18N} "Every text follows a switch"`, async ({ page }) => {
		await installConsole(page, { rpc: BASE, language: 'en' })
		await page.goto(`${ORG}/settings`)
		await expect(
			page.getByRole('heading', { level: 1, name: 'Settings' }),
		).toBeVisible()
		await expect(
			part(page, 'Business details').getByRole('term').first(),
		).toHaveText('Legal name')

		// Switch to Japanese from the account menu.
		await page.getByRole('button', { name: 'Account' }).click()
		await page.getByRole('button', { name: '日本語' }).click()
		await expect(
			page.getByRole('heading', { level: 1, name: '設定' }),
		).toBeVisible()

		// The business detail labels, from the view-model, are Japanese.
		await expect(part(page, '事業者情報').getByRole('term')).toHaveText([
			'事業者名',
			'代表者名',
			'所在地',
			'電話番号',
			'連絡先メールアドレス',
		])

		// The account menu marks the chosen language.
		await page.getByRole('button', { name: 'アカウント' }).click()
		const japanese = page.getByRole('button', { name: '日本語' })
		const english = page.getByRole('button', { name: 'English' })
		await expect(japanese).toHaveAttribute('aria-pressed', 'true')
		await expect(english).toHaveAttribute('aria-pressed', 'false')
		await expect(japanese.locator('.menu-check')).toBeVisible()
		await expect(english.locator('.menu-check')).toBeHidden()
		await page.keyboard.press('Escape')

		// Then the concert editor, reached without a reload.
		await page
			.getByRole('navigation', { name: 'メインナビゲーション' })
			.getByRole('link', { name: '公演' })
			.click()
		await page.getByRole('link', { name: '公演をつくる' }).first().click()
		await expect(
			page.getByRole('heading', { level: 1, name: '新しい公演' }),
		).toBeVisible()
		const type = page.getByRole('group', { name: '種類' })
		await expect(type.getByRole('radio')).toHaveCount(3)
		for (const name of ['単独公演', 'ツアー', 'フェス']) {
			await expect(type.getByRole('radio', { name })).toBeVisible()
		}
		const visibility = page.getByRole('group', { name: '公開範囲' })
		await expect(visibility.getByRole('radio', { name: /^公開/ })).toBeVisible()
		await expect(
			visibility.getByRole('radio', { name: /^限定公開/ }),
		).toBeVisible()
		await expect(page.locator('organizer-shell')).not.toContainText(
			/Single show|Tour|Festival|Public|Unlisted|Legal name/,
		)
	})
})
