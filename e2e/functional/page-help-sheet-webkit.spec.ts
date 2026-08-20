import { expect, test } from '@playwright/test'

/**
 * WebKit regression guard for the "flash then close" bottom-sheet defect.
 *
 * Root cause: the programmatic initial re-snap in the CSS `initial-snap`
 * animation produced a scroll-ratio trace [1, 0] that the old `scrollend` /
 * `pointerup` scroll-ratio heuristics misread as a user swipe-to-dismiss.
 * This caused the page-help sheet to open and immediately close on WebKit.
 *
 * Fix: replace those heuristics with `scrollsnapchange` (user-gesture-only
 * per spec) and an `IntersectionObserver` fallback. The programmatic re-snap
 * cannot fire `scrollsnapchange`, so the sheet no longer auto-closes.
 *
 * Projects:
 *  - webkit-repro:     real WebKit, iPhone 14 — RED before the fix, GREEN after
 *  - chromium-control: Chromium, iPhone 14  — GREEN before and after (control)
 *
 * This spec is excluded from the default `functional` (Desktop Chrome) project
 * to avoid running a redundant Chromium pass; the `chromium-control` project
 * serves that role on the same viewport.
 */
test('page-help sheet opens and stays open (not auto-dismissed)', async ({ page }) => {
	await page.goto('/my-artists')

	// Click the `?` help trigger button to open the page-help sheet.
	// The `?` button renders in the page-header for all states (loading,
	// empty, populated), so no artist data is required.
	const helpBtn = page.getByRole('button', {
		name: /show help/i,
	})
	await expect(helpBtn).toBeVisible()
	await helpBtn.click()

	// Wait for the bottom-sheet <dialog> to open.
	const dialog = page.locator('bottom-sheet dialog').first()
	await expect(dialog).toBeVisible()

	// Sample dialog.open over ~1.5 s (15 × 100 ms intervals).
	// On the buggy build this fails within the first few samples because the
	// scroll-ratio heuristics fire on the programmatic initial re-snap and
	// call close() before the user has interacted.
	const samples: boolean[] = []
	for (let i = 0; i < 15; i++) {
		await page.waitForTimeout(100)
		const isOpen = await dialog.evaluate(
			(el) => (el as HTMLDialogElement).open,
		)
		samples.push(isOpen)
	}

	// Every sample must be true — dialog must stay open the entire 1.5 s.
	for (const [i, isOpen] of samples.entries()) {
		expect(isOpen, `dialog.open was false at sample ${i + 1}`).toBe(true)
	}

	// Also verify that sheet CONTENT is visible, not merely the dialog element.
	// If WebKit parks the scroll on the dismiss zone (ratio 0) after the
	// initial-snap, the sheet body would be off-screen while dialog.open=true.
	await expect(page.locator('.sheet-body')).toBeVisible()
})
