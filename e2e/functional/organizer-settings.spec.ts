import {
	connectError,
	installConsole,
	ORG,
	type RpcMocks,
} from '../support/organizer'
import {
	ONBOARDING_URL,
	onboardingLink,
	organizer,
	payoutAccount,
	seriesList,
} from '../support/organizer-data'
import { expect, type Page, test } from '../support/test'

/**
 * Settings: the Organizer's name and represented Artists, its business
 * details and its payout account status, all read only, in sections headed
 * 組織, アーティスト, 事業者情報 and 入金口座; the hand-off to Stripe is
 * explained before the action that opens Stripe's page in the same tab.
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
	await page.goto(`${ORG}/settings`)
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
		await expect(page.getByRole('heading', { level: 2 })).toHaveText([
			'組織',
			'アーティスト',
			'事業者情報',
			'入金口座',
		])
		const organization = part(page, '組織')
		await expect(organization.getByRole('definition')).toHaveText('XX Records')
		await expect(organization).toContainText('Liverty Music が承ります')
		await expect(part(page, 'アーティスト').getByRole('listitem')).toHaveText([
			'Band A',
			'Band B',
		])
		// Read only: nothing to edit.
		await expect(
			page.locator('settings-route').getByRole('textbox'),
		).toHaveCount(0)
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
	/** What the hand-off is, said before the member leaves the console. */
	const HAND_OFF = [
		'ファンはチケットを購入できます',
		'Liverty Music の決済代行会社 Stripe',
		'事業者の情報、代表者の本人確認、入金先の銀行口座',
		'Stripe からコンソールのホームに戻ります',
	]

	/** The onboarding action, marked as going to an external site. */
	const onboardingAction = (page: Page, label: string) =>
		part(page, '入金口座').getByRole('button', {
			name: new RegExp(`^${label}\\s*（外部サイトに移動します）$`),
		})

	/** Serves Stripe's page, so the hand-off can be followed. */
	async function serveStripe(page: Page) {
		await page.route(`${ONBOARDING_URL}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<title>Stripe</title>',
			}),
		)
	}

	test(`@spec ${SPEC} "No payout account yet"`, async ({ page }) => {
		await openSettings(page, {
			'PayoutAccountService/Get': () =>
				connectError('not_found', 'no payout account', 404),
		})
		const payout = part(page, '入金口座')
		for (const text of HAND_OFF) await expect(payout).toContainText(text)
		await expect(onboardingAction(page, 'Stripe で登録する')).toBeVisible()
		await expect(payout.getByTestId('payout-status')).toHaveCount(0)
		await expect(payout).not.toContainText('状態')
		await expect(payout).not.toContainText('読み込めませんでした')
	})

	test(`@spec ${SPEC} "Onboarding not finished"`, async ({ page }) => {
		await openSettings(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
		})
		const payout = part(page, '入金口座')
		await expect(payout.getByTestId('payout-status')).toHaveText('確認中')
		for (const text of HAND_OFF) await expect(payout).toContainText(text)
		const proceed = onboardingAction(page, 'Stripe で登録を続ける')
		await expect(proceed).toHaveAttribute('data-variant', 'outlined')
		// The explanation comes before the action.
		const order = await payout.evaluate((section) => {
			const text = section.textContent ?? ''
			return (
				text.indexOf('Stripe からコンソールのホームに戻ります') <
				text.indexOf('Stripe で登録を続ける')
			)
		})
		expect(order).toBe(true)
	})

	test(`@spec ${SPEC} "Member goes to Stripe"`, async ({ page }) => {
		let answer: () => void = () => {}
		const answered = new Promise<void>((resolve) => {
			answer = resolve
		})
		const log = await openSettings(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
			'PayoutAccountService/StartOnboarding': async () => {
				await answered
				return { body: onboardingLink() }
			},
		})
		await serveStripe(page)
		const proceed = onboardingAction(page, 'Stripe で登録を続ける')
		await proceed.click()

		// Unavailable while the onboarding page is prepared.
		await expect(proceed).toHaveAttribute('aria-disabled', 'true')
		await proceed.click({ force: true })
		answer()

		// Stripe's page opens in this tab.
		await expect(page).toHaveURL(ONBOARDING_URL)
		expect(page.context().pages()).toHaveLength(1)
		expect(
			log.calls.filter(
				(c) => c.method === 'PayoutAccountService/StartOnboarding',
			),
		).toHaveLength(1)
	})

	test(`@spec ${SPEC} "Stripe's page cannot be prepared"`, async ({ page }) => {
		const log = await openSettings(page, {
			'PayoutAccountService/Get': payoutAccount('PENDING'),
			'PayoutAccountService/StartOnboarding': () =>
				connectError('unavailable', 'stripe: connection refused', 503),
		})
		const proceed = onboardingAction(page, 'Stripe で登録を続ける')
		await proceed.click()

		const payout = part(page, '入金口座')
		await expect(payout.getByRole('alert')).toHaveText(
			'Stripe のページを開けませんでした。もう一度お試しください。',
		)
		await expect(page.locator('body')).not.toContainText('connection refused')
		await expect(page).toHaveURL(new RegExp(`${ORG}/settings`))

		// The action is available again.
		await expect(proceed).not.toHaveAttribute('aria-disabled', 'true')
		await proceed.click()
		await expect
			.poll(
				() =>
					log.calls.filter(
						(c) => c.method === 'PayoutAccountService/StartOnboarding',
					).length,
			)
			.toBe(2)
	})

	test(`@spec ${SPEC} "Back from onboarding"`, async ({ page }) => {
		// Stripe brings the member back to the console's address, which opens Home.
		for (const [status, payoutItems] of [
			['ACTIVE', 0],
			['PENDING', 1],
		] as const) {
			const log = await installConsole(page, {
				rpc: { ...BASE, 'PayoutAccountService/Get': payoutAccount(status) },
				language: 'ja',
			})
			await page.goto('/')
			await expect(
				page.getByRole('heading', { level: 1, name: 'ホーム' }),
			).toBeVisible()
			await expect
				.poll(() =>
					log.calls.some((c) => c.method === 'PayoutAccountService/Get'),
				)
				.toBe(true)
			await expect(
				page.getByRole('link', { name: /入金口座の登録が終わっていません/ }),
			).toHaveCount(payoutItems)
		}
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

	test(`@spec ${SPEC} "Active account"`, async ({ page }) => {
		await openSettings(page)
		const payout = part(page, '入金口座')
		await expect(payout.getByTestId('payout-status')).toHaveText('有効')
		await expect(payout.getByRole('button')).toHaveCount(0)
		await expect(payout).not.toContainText('ファンはチケットを購入できます')
		await expect(payout).not.toContainText('Stripe')
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
