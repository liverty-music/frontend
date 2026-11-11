import { OIDC_AUTHORITY } from '../support/auth-mocks'
import { callsOf, FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { box, openShell, seedSignedInFan, tapTab } from '../support/fan-shell'
import { expect, type Locator, type Page, test } from '../support/test'

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

const _SIGNED_IN_TITLES = [
	'アカウント',
	'チケットの名義',
	'通知とサウンド',
	'表示と操作',
	'サービス改善の協力',
	'このアプリについて',
]

const _sectionTitles = (page: Page) =>
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

/** The computed background colour of an element. */
const background = (el: Locator) =>
	el.evaluate((node) => getComputedStyle(node).backgroundColor)

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
	test(`@spec ${SETTINGS} "Guest sees a prominent sign-in hero at the top"`, async ({
		page,
	}) => {
		await openAsGuest(page)
		const hero = page.locator('settings-route .settings-guest-hero')
		const signIn = page.getByTestId('settings-sign-in')
		const signUp = page.getByTestId('settings-sign-up')
		// Above the preferences.
		const firstTitle = page.locator('settings-route .settings-section-title')
		expect((await box(hero)).y).toBeLessThan((await box(firstTitle.first())).y)
		// Brand-tinted, unlike the plain list cards, with a filled primary
		// action and an outlined secondary one.
		expect(await background(hero)).not.toBe(
			await background(page.locator('settings-route .settings-card').first()),
		)
		await expect(signIn).toHaveText('ログイン')
		await expect(signUp).toHaveText('新規登録')
		await expect(signUp).toHaveAttribute('data-variant', 'outlined')
		await expect(signIn).not.toHaveAttribute('data-variant', /./)
		expect(await background(signIn)).not.toBe(await background(signUp))
		// No account rows: no email address, badge or resend control.
		await expect(
			page.locator('settings-route section', {
				has: page.locator('h2', { hasText: 'アカウント' }),
			}),
		).toHaveCount(0)
		await expect(page.getByText(FAN_EMAIL)).toHaveCount(0)
	})

	for (const [testId, signUp] of [
		['settings-sign-in', false],
		['settings-sign-up', true],
	] as const) {
		test(`@spec ${SETTINGS} "Guest sees a prominent sign-in hero at the top" (${testId} starts the OIDC flow)`, async ({
			page,
		}) => {
			await openAsGuest(page)
			const authorize = page.waitForRequest((req) =>
				req.url().startsWith(`${OIDC_AUTHORITY}/oauth/v2/authorize`),
			)
			await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) =>
				route.fulfill({ status: 200, contentType: 'text/html', body: '' }),
			)
			await page.getByTestId(testId).click()
			const url = new URL((await authorize).url())
			// Only sign-up asks the identity provider for its sign-up form.
			expect(url.searchParams.get('prompt') === 'create').toBe(signUp)
		})
	}

	test(`@spec ${SETTINGS} "First preferences row is visible on load"`, async ({
		page,
	}) => {
		await openAsFan(page)
		const header = await box(page.locator('page-header'))
		const title = page.locator('settings-route .settings-section-title').first()
		await expect(title).toHaveText('アカウント')
		const firstRow = page.locator('settings-route .settings-card').first()
		for (const el of [
			title,
			firstRow.locator(':is(.settings-row, .list-item)').first(),
		]) {
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
	test(`@spec ${SETTINGS} "Legal links"`, async ({ page }) => {
		for (const [label, path] of [
			['利用規約', '/legal/terms'],
			['プライバシーポリシー', '/legal/privacy'],
			['OSSライセンス', '/legal/licenses'],
		]) {
			await openAsGuest(page)
			await page
				.locator('settings-route :is(.settings-row, .list-item)', {
					hasText: label,
				})
				.click()
			await page.waitForURL((url) => url.pathname === path)
		}
	})
})

test.describe('consent wording', () => {
	const consent = (page: Page) =>
		page.locator('settings-route section[aria-labelledby="analytics-title"]')

	test(`@spec ${SETTINGS} "Both toggles default to on"`, async ({ page }) => {
		await openAsFan(page)
		const switches = consent(page).getByRole('switch')
		await expect(switches).toHaveCount(2)
		for (const s of await switches.all()) {
			await expect(s).toHaveAttribute('aria-checked', 'true')
		}
	})

	test(`@spec ${SETTINGS} "Settings opt-out persists for a purpose granted at signup"`, async ({
		page,
	}) => {
		// Both purposes are granted by default from sign-up on.
		await openAsFan(page)
		const analytics = () => consent(page).getByRole('switch').first()
		const replay = () => consent(page).getByRole('switch').nth(1)
		await expect(analytics()).toHaveAttribute('aria-checked', 'true')
		await analytics().click()
		await expect(analytics()).toHaveAttribute('aria-checked', 'false')

		// The withdrawal is persisted: a fresh load shows it.
		await page.reload()
		await expect(page.locator('settings-route')).toBeVisible()
		await expect(analytics()).toHaveAttribute('aria-checked', 'false')
		await expect(replay()).toHaveAttribute('aria-checked', 'true')
	})
})

test.describe('name on your tickets', () => {
	const row = (page: Page) => page.getByTestId('settings-personal-details-row')
	const dialog = (page: Page) =>
		page.getByRole('dialog', { name: '名義を変更しますか？' })

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

	test('keeps Tab and Shift+Tab inside the sheet while the confirmation is closed', async ({
		page,
	}) => {
		await openAsFan(page, { fullName: '山田 花子' })
		await row(page).click()
		const name = page.getByTestId('settings-full-name')
		const phone = page.getByTestId('settings-phone-number')
		await name.focus()
		// Save is disabled for an unchanged form, so the phone field is the
		// last control; the closed dialog's buttons must not count.
		await page.keyboard.press('Shift+Tab')
		await expect(phone).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(name).toBeFocused()
	})

	// Cancel is a fixture test (settings-route.fixture.spec.ts); only a real
	// browser turns the Escape key into a close of the top-layer dialog.
	test(`@spec ${SETTINGS} "Fan cancels the confirmation" (Escape)`, async ({
		page,
	}) => {
		const calls = await openAsFan(page, { fullName: '山田 花子' })
		await row(page).click()
		await page.getByTestId('settings-full-name').fill('鈴木 一郎')
		await page.getByTestId('settings-personal-details-save').click()
		await expect(dialog(page)).toBeVisible()

		await page.keyboard.press('Escape')

		await expect(dialog(page)).toBeHidden()
		// The sheet stays open with the fan's input.
		await expect(page.getByTestId('settings-full-name')).toBeVisible()
		await expect(page.getByTestId('settings-full-name')).toHaveValue(
			'鈴木 一郎',
		)
		expect(callsOf(calls, 'UserService/Update')).toHaveLength(0)
	})
})

test.describe('sign out', () => {
	const signOut = (page: Page) =>
		page.getByRole('button', { name: 'サインアウト', exact: true }).first()
	const dialog = (page: Page) =>
		page.getByRole('dialog', { name: 'サインアウトしますか？' })

	// Cancel is a fixture test (settings-route.fixture.spec.ts); only a real
	// browser turns the Escape key into a close of the top-layer dialog.
	test(`@spec ${SETTINGS} "Sign out cancelled" (Escape)`, async ({ page }) => {
		let endSession = false
		await page.route(`${OIDC_AUTHORITY}/oidc/v1/end_session**`, (route) => {
			endSession = true
			return route.abort()
		})
		await openAsFan(page)
		await signOut(page).click()
		await expect(dialog(page)).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(dialog(page)).toBeHidden()
		expect(new URL(page.url()).pathname).toBe('/settings')
		await expect(signOut(page)).toBeVisible()
		expect(endSession).toBe(false)
	})

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
		const lastRow = await box(
			about.locator(':is(.settings-row, .list-item)').last(),
		)
		const group = await box(page.getByTestId('settings-sign-out-group'))
		expect(group.y - (lastRow.y + lastRow.height)).toBeGreaterThanOrEqual(24)
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

test(`@spec ${GUEST_STORY} "Guest navigates to Tickets after dashboard"`, async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem('onboardingComplete', 'true')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('pwa.installed', 'true')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('language', 'ja')
	})
	await mockFanRpc(page)
	await openShell(page, '/dashboard')
	await tapTab(page, 'ticket')
	await page.waitForURL((url) => url.pathname === '/tickets')
	// The Tickets screen's own empty state, not a redirect.
	await expect(page.locator('tickets-route')).toBeVisible()
	await expect(page.getByText('まだチケットがありません')).toBeVisible()
	expect(new URL(page.url()).pathname).toBe('/tickets')
})
