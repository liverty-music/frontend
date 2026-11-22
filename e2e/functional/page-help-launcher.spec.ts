import {
	fab,
	fabItems,
	openShell,
	seedSignedInFan,
	settle,
} from '../support/fan-shell'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ viewport: { width: 390, height: 844 } })

/**
 * Where help lives: an item of the FAB launcher on the three pages that have
 * help content, never a `?` button in the page header, and no item on a page
 * without help. The sheet's content is checked in
 * test/components/page-help-content.fixture.spec.ts.
 */

const HELP = 'components/infrastructure/fan/web/global/page-help'
const PAGES_WITH_HELP = ['/discovery', '/timetable', '/my-artists']

const helpItem = (page: Page) =>
	page.locator('action-menu .fab-item[data-action-id="help"]')

async function openLauncher(page: Page): Promise<void> {
	await fab(page).click()
	await expect(fab(page)).toHaveAttribute('aria-expanded', 'true')
	await settle(page, 'action-menu')
}

test.beforeEach(async ({ page }) => {
	await seedSignedInFan(page, { language: 'ja' })
})

for (const path of PAGES_WITH_HELP) {
	test(`@spec ${HELP} "Help icon is always visible" (${path})`, async ({
		page,
	}) => {
		await openShell(page, path)
		await openLauncher(page)

		const item = helpItem(page)
		await expect(item).toBeVisible()
		await expect(item.locator('svg-icon')).toHaveCount(1)
		await expect(item.locator('.fab-item-label')).toHaveText('ヘルプ')

		await item.click()
		await expect(page.locator('page-help .sheet-body')).toBeVisible()
	})

	test(`@spec ${HELP} "No \`?\` trigger in the page header" (${path})`, async ({
		page,
	}) => {
		await openShell(page, path)

		// With the launcher closed, no visible control on the page offers help.
		await expect(
			page.getByRole('button', { name: /^(\?|ヘルプ|Help)$/ }),
		).toHaveCount(0)
		await expect(
			page.locator('header').getByText('?', { exact: true }),
		).toHaveCount(0)

		await openLauncher(page)
		await expect(helpItem(page)).toBeVisible()
	})
}

test(`@spec ${HELP} "Pages without page-specific help contribute no help item"`, async ({
	page,
}) => {
	await openShell(page, '/settings')

	// Settings contributes no action at all, so the launcher is not shown.
	await expect(page.locator('action-menu')).toHaveCount(0)
	await expect(
		fabItems(page).and(page.locator('[data-action-id="help"]')),
	).toHaveCount(0)
	await expect(page.locator('page-help')).toHaveCount(0)
})
