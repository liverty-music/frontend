import { OIDC_AUTHORITY } from '../support/auth-mocks'
import { callsOf, FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { box, openShell, seedSignedInFan } from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })

/**
 * The fan Settings page: the order of its sections, its rows, the consent
 * wording, the name on the tickets edited in a sheet, and the confirmations
 * before Sign Out and before a name change. The backend and the identity
 * provider are mocked.
 */

const SETTINGS = 'components/infrastructure/fan/web/route/settings'
const GUEST_STORY = 'stories/roam-app-as-guest'

const SIGNED_IN_TITLES = [
	'アカウント',
	'チケットの名義',
	'通知とサウンド',
	'表示と操作',
	'サービス改善の協力',
	'このアプリについて',
]

const sectionTitles = (page: Page) =>
	page.locator('settings-route .settings-section-title').allTextContents()

/** A signed-in fan whose saved User carries these ticket details. */
async function openAsFan(
	page: Page,
	details: { fullName?: string; phoneNumber?: string } = {},
) {
	await seedSignedInFan(page, { language: 'ja' })
	const user = {
		id: { value: FAN_SUB },
		email: { value: FAN_EMAIL },
		preferredLanguage: 'ja',
		home: { countryCode: 'JP', level1: 'JP-13' },
		...(details.fullName ? { fullName: { value: details.fullName } } : {}),
		...(details.phoneNumber
			? { phoneNumber: { value: details.phoneNumber } }
			: {}),
	}
	// Registered after the seed's mock, so it answers first.
	const calls = await mockFanRpc(page, {
		'UserService/Get': { user },
		'UserService/Update': (body) => {
			const wire = body as {
				fullName?: { value: string }
				phoneNumber?: { value: string }
			}
			return {
				body: {
					user: {
						...user,
						...(wire.fullName ? { fullName: wire.fullName } : {}),
						...(wire.phoneNumber ? { phoneNumber: wire.phoneNumber } : {}),
					},
				},
			}
		},
	})
	await openShell(page, '/settings')
	await expect(page.locator('settings-route')).toBeVisible()
	return calls
}

/** A guest past onboarding. */
async function openAsGuest(page: Page): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('language', 'ja')
	})
	await mockFanRpc(page)
	await openShell(page, '/settings')
	await expect(page.locator('settings-route')).toBeVisible()
}

/** Whether the centre of `selector` is topped by that element (nothing over it). */
async function onTop(page: Page, selector: string): Promise<boolean> {
	return page.locator(selector).evaluate((el) => {
		const r = el.getBoundingClientRect()
		const top = document.elementFromPoint(
			r.left + r.width / 2,
			r.top + r.height / 2,
		)
		return el.contains(top)
	})
}

test.describe('section order', () => {
	test(`@spec ${SETTINGS} "Signed-in fan sees the account first"`, async ({
		page,
	}) => {
		await openAsFan(page)
		expect(await sectionTitles(page)).toEqual(SIGNED_IN_TITLES)
		// Sign Out, then Delete account, close the page.
		const groups = await page
			.getByTestId('settings-scroll')
			.evaluate((el) =>
				[...el.children].slice(-2).map((c) => c.getAttribute('data-testid')),
			)
		expect(groups).toEqual([
			'settings-sign-out-group',
			'settings-delete-account-group',
		])
	})

	test(`@spec ${SETTINGS} "Guest sees the hero, then the preferences"`, async ({
		page,
	}) => {
		await openAsGuest(page)
		await expect(page.getByTestId('settings-sign-in')).toBeVisible()
		expect(await sectionTitles(page)).toEqual([
			'通知とサウンド',
			'表示と操作',
			'サービス改善の協力',
			'このアプリについて',
		])
		await expect(page.getByText('プッシュ通知')).toHaveCount(0)
		await expect(page.getByTestId('settings-personal-details-row')).toHaveCount(
			0,
		)
		await expect(page.getByTestId('settings-delete-account-group')).toHaveCount(
			0,
		)
	})

	test(`@spec ${SETTINGS} "First preferences row is visible on load"`, async ({
		page,
	}) => {
		await openAsFan(page)
		const header = await box(page.locator('page-header'))
		const title = page.locator('settings-route .settings-section-title').first()
		await expect(title).toHaveText('アカウント')
		const firstRow = page.locator('settings-route .settings-card').first()
		for (const el of [title, firstRow.locator('.settings-row').first()]) {
			await expect(el).toBeInViewport()
			expect((await box(el)).y).toBeGreaterThanOrEqual(
				header.y + header.height - 1,
			)
		}
	})

	test(`@spec ${SETTINGS} "Authenticated user sees account controls and no guest hero"`, async ({
		page,
	}) => {
		await openAsFan(page)
		await expect(page.getByTestId('settings-sign-in')).toHaveCount(0)
		const account = page.locator('settings-route section').first()
		await expect(account.locator('h2')).toHaveText('アカウント')
		await expect(account).toContainText(FAN_EMAIL)
		await expect(page.getByTestId('settings-sign-out-group')).toBeVisible()
	})
})

test.describe('rows', () => {
	test(`@spec ${SETTINGS} "Consent rows and Passkeys"`, async ({ page }) => {
		await openAsFan(page)
		// Each row's glyph, as drawn: no two rows draw the same one.
		const glyphs = await page
			.locator('settings-route .settings-icon')
			.evaluateAll((els) => els.map((el) => el.innerHTML.trim()))
		expect(glyphs.length).toBeGreaterThan(0)
		expect(new Set(glyphs).size).toBe(glyphs.length)
	})

	test(`@spec ${SETTINGS} "Legal links"`, async ({ page }) => {
		for (const [label, path] of [
			['利用規約', '/legal/terms'],
			['プライバシーポリシー', '/legal/privacy'],
			['OSSライセンス', '/legal/licenses'],
		]) {
			await openAsGuest(page)
			await page
				.locator('settings-route .settings-row', { hasText: label })
				.click()
			await page.waitForURL((url) => url.pathname === path)
		}
	})

	test(`@spec ${SETTINGS} "Contact support"`, async ({ page }) => {
		await openAsGuest(page)
		const contact = page.getByTestId('settings-contact')
		await expect(contact).toHaveText(/お問い合わせ/)
		await expect(contact).toHaveAttribute('href', /^mailto:.+@.+/)
	})

	test(`@spec ${SETTINGS} "One Privacy Policy link next to the toggles"`, async ({
		page,
	}) => {
		await openAsGuest(page)
		await expect(
			page.locator('settings-route .settings-row', {
				hasText: 'プライバシーポリシー',
			}),
		).toHaveCount(1)
		await expect(page.getByTestId('settings-analytics-policy-note')).toHaveText(
			'データの扱いはプライバシーポリシーで詳しく説明しています。',
		)
		await page.getByTestId('settings-analytics-policy-link').click()
		await page.waitForURL((url) => url.pathname === '/legal/privacy')
	})
})

test.describe('consent wording', () => {
	const consent = (page: Page) =>
		page.locator('settings-route section[aria-labelledby="analytics-title"]')

	test(`@spec ${SETTINGS} "Analytics toggle is labeled by its purpose"`, async ({
		page,
	}) => {
		await openAsGuest(page)
		await expect(consent(page).locator('h2')).toHaveText('サービス改善の協力')
		await expect(consent(page)).toContainText('利用状況を共有する')
	})

	test(`@spec ${SETTINGS} "Session-replay toggle is labeled by its purpose"`, async ({
		page,
	}) => {
		await openAsGuest(page)
		await expect(consent(page)).toContainText('画面操作ログを共有する')
	})

	test(`@spec ${SETTINGS} "Both toggles default to on"`, async ({ page }) => {
		await openAsFan(page)
		const switches = consent(page).getByRole('switch')
		await expect(switches).toHaveCount(2)
		for (const s of await switches.all()) {
			await expect(s).toHaveAttribute('aria-checked', 'true')
		}
	})

	test(`@spec ${SETTINGS} "No anonymity claim"`, async ({ page }) => {
		await openAsGuest(page)
		// Open both descriptions.
		for (const label of ['利用状況を共有する', '画面操作ログを共有する']) {
			await consent(page).getByText(label).click()
		}
		await expect(consent(page)).not.toContainText('匿名')
	})
})

test.describe('name on your tickets', () => {
	const row = (page: Page) => page.getByTestId('settings-personal-details-row')
	const dialog = (page: Page) =>
		page.getByRole('dialog', { name: '名義を変更しますか？' })

	test(`@spec ${SETTINGS} "No details saved yet"`, async ({ page }) => {
		await openAsFan(page)
		await expect(row(page)).toContainText('未設定')
		await row(page).click()
		await expect(page.getByTestId('settings-full-name')).toBeVisible()
		await expect(page.getByTestId('settings-full-name')).toHaveValue('')
		await expect(page.getByTestId('settings-phone-number')).toHaveValue('')
		await expect(page.getByTestId('settings-full-name')).toBeEditable()
	})

	test(`@spec ${SETTINGS} "Fan changes their phone number"`, async ({
		page,
	}) => {
		const calls = await openAsFan(page, {
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		await expect(row(page)).toContainText('山田 花子')
		await expect(row(page)).toContainText('090-1234-5678')
		await row(page).click()
		await page.getByTestId('settings-phone-number').fill('090-9876-5432')
		await page.getByTestId('settings-personal-details-save').click()
		await dialog(page).getByRole('button', { name: '変更する' }).click()

		await expect(row(page)).toContainText('090-9876-5432')
		await expect(page.getByTestId('settings-full-name')).toBeHidden()
		const updates = callsOf(calls, 'UserService/Update')
		expect(updates).toHaveLength(1)
		expect(updates[0].body).toEqual({
			phoneNumber: { value: '+819098765432' },
		})
	})

	test(`@spec ${SETTINGS} "Saving asks first"`, async ({ page }) => {
		const calls = await openAsFan(page, {
			fullName: '山田 花子',
			phoneNumber: '+819012345678',
		})
		await row(page).click()
		await page.getByTestId('settings-full-name').fill('山田 花')
		await page.getByTestId('settings-personal-details-save').click()

		await expect(dialog(page)).toBeVisible()
		await expect(dialog(page)).toContainText('山田 花 / 090-1234-5678')
		await expect(dialog(page)).toContainText(
			'保有中のチケットの券面もこの名義に変わります',
		)
		await expect(
			dialog(page).getByRole('button', { name: 'キャンセル' }),
		).toBeFocused()
		// The dialog is the top-most element over the open sheet.
		expect(
			await onTop(page, '[data-testid="settings-personal-details-confirm"]'),
		).toBe(true)
		expect(callsOf(calls, 'UserService/Update')).toHaveLength(0)
	})

	for (const how of ['Cancel', 'Escape'] as const) {
		test(`@spec ${SETTINGS} "Fan cancels the confirmation" (${how})`, async ({
			page,
		}) => {
			const calls = await openAsFan(page, { fullName: '山田 花子' })
			await row(page).click()
			await page.getByTestId('settings-full-name').fill('鈴木 一郎')
			await page.getByTestId('settings-personal-details-save').click()
			await expect(dialog(page)).toBeVisible()

			if (how === 'Cancel') {
				await dialog(page).getByRole('button', { name: 'キャンセル' }).click()
			} else {
				await page.keyboard.press('Escape')
			}

			await expect(dialog(page)).toBeHidden()
			// The sheet stays open with the fan's input.
			await expect(page.getByTestId('settings-full-name')).toBeVisible()
			await expect(page.getByTestId('settings-full-name')).toHaveValue(
				'鈴木 一郎',
			)
			expect(callsOf(calls, 'UserService/Update')).toHaveLength(0)
		})
	}
})

test.describe('sign out', () => {
	const signOut = (page: Page) =>
		page.getByRole('button', { name: 'サインアウト', exact: true }).first()
	const dialog = (page: Page) =>
		page.getByRole('dialog', { name: 'サインアウトしますか？' })

	test(`@spec ${SETTINGS} "Sign out asks first"`, async ({ page }) => {
		await openAsFan(page)
		await signOut(page).click()
		await expect(dialog(page)).toBeVisible()
		await expect(dialog(page)).toContainText(
			'次に使うときは、パスキーでもう一度ログインします。',
		)
		await expect(
			dialog(page).getByRole('button', { name: 'キャンセル' }),
		).toBeFocused()
	})

	for (const how of ['Cancel', 'Escape'] as const) {
		test(`@spec ${SETTINGS} "Sign out cancelled" (${how})`, async ({
			page,
		}) => {
			let endSession = false
			await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) => {
				endSession = true
				return route.abort()
			})
			await openAsFan(page)
			await signOut(page).click()
			await expect(dialog(page)).toBeVisible()
			if (how === 'Cancel') {
				await dialog(page).getByRole('button', { name: 'キャンセル' }).click()
			} else {
				await page.keyboard.press('Escape')
			}
			await expect(dialog(page)).toBeHidden()
			expect(new URL(page.url()).pathname).toBe('/settings')
			await expect(signOut(page)).toBeVisible()
			expect(endSession).toBe(false)
		})
	}

	test(`@spec ${SETTINGS} "Sign out action"`, async ({ page }) => {
		// The seed signs the fan in again on every load, so the return to the
		// Landing Page is checked in carry-locale-across-sign-out.spec.ts; here
		// the confirmation leads to the identity provider's end of session.
		await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) =>
			route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
		)
		await openAsFan(page)
		await signOut(page).click()
		const endSession = page.waitForRequest((req) =>
			req.url().startsWith(`${OIDC_AUTHORITY}/oidc/v1/end_session`),
		)
		await dialog(page).getByRole('button', { name: 'サインアウト' }).click()
		await endSession
	})

	test(`@spec ${SETTINGS} "Sign out apart from account rows"`, async ({
		page,
	}) => {
		await openAsFan(page)
		const about = page.locator('settings-route section', {
			has: page.locator('h2', { hasText: 'このアプリについて' }),
		})
		const lastRow = await box(about.locator('.settings-row').last())
		const group = await box(page.getByTestId('settings-sign-out-group'))
		expect(group.y - (lastRow.y + lastRow.height)).toBeGreaterThanOrEqual(24)
	})

	test(`@spec ${SETTINGS} "Sign out hidden for guests"`, async ({ page }) => {
		await openAsGuest(page)
		await expect(page.getByTestId('settings-sign-out-group')).toHaveCount(0)
		await expect(
			page.getByRole('button', { name: 'サインアウト' }),
		).toHaveCount(0)
	})
})

test(`@spec ${GUEST_STORY} "Guest navigates to Settings after dashboard"`, async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
	})
	await mockFanRpc(page)
	await openShell(page, '/dashboard')
	await page.locator('fab-menu .fab-toggle').click()
	await page.locator('fab-menu .fab-item[data-action-id="settings"]').click()
	await page.waitForURL((url) => url.pathname === '/settings')
	await expect(page.getByTestId('settings-sign-in')).toBeVisible()
})
