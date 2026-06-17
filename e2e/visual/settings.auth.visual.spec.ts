import { expect, test } from '@playwright/test'

test.describe('Settings page visual regression (authenticated)', () => {
	test('settings page layout', async ({ page }) => {
		await page.goto('/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		await expect(page).toHaveScreenshot('settings-layout.png')
	})

	/**
	 * Layout regression guard for the fix-settings-layout change.
	 *
	 * The original bug: Settings `main` was itself the scroll container but
	 * omitted `min-block-size: 0`, so its `1fr` grid track grew to full content
	 * height, the grid overflowed, and the first PREFERENCES row slid up *behind*
	 * the fixed `page-header`. The fix re-aligned Settings with the house scroll
	 * pattern (shell `main` + inner `.settings-scroll`). The screenshot baseline
	 * above catches pixel drift; this assertion locks in the specific geometry
	 * (first row below the header bottom) so a future edit that reintroduces the
	 * overlap fails loudly even if the screenshot tolerance would absorb it.
	 */
	test('first preferences row is not clipped by the fixed header', async ({
		page,
	}) => {
		await page.goto('/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		const header = page.getByTestId('settings-header')
		const firstRow = page.getByTestId('settings-first-row')

		await expect(header).toBeVisible()
		await expect(firstRow).toBeVisible()

		const headerBox = await header.boundingBox()
		const firstRowBox = await firstRow.boundingBox()
		expect(headerBox).not.toBeNull()
		expect(firstRowBox).not.toBeNull()
		if (!headerBox || !firstRowBox) return

		// The first row's top edge must sit at or below the header's bottom edge —
		// i.e. the row is rendered inside the scroll area, not underneath the
		// pinned header. A 1px tolerance absorbs sub-pixel rounding.
		expect(firstRowBox.y).toBeGreaterThanOrEqual(
			headerBox.y + headerBox.height - 1,
		)
	})
})
