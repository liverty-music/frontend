import { expect, test } from '../support/test'

/**
 * WebKit regression guard for the "flash then close" bottom-sheet defect.
 *
 * Root cause: the programmatic initial re-snap in the CSS `initial-snap`
 * animation produced a scroll-ratio trace [1, 0] that the old `scrollend` /
 * `pointerup` scroll-ratio heuristics misread as a user swipe-to-dismiss.
 * This caused the page-help sheet to open and immediately close on WebKit.
 *
 * Fix: the sheet is a non-modal `popover` whose dismiss is driven by an
 * `IntersectionObserver` on the sheet body, armed only after the body has
 * settled fully visible (the "just-opened" guard). The transient off-screen
 * ratio during the initial re-snap is ignored, so the sheet no longer
 * auto-closes.
 *
 * Projects:
 *  - webkit-repro:     real WebKit, iPhone 14 — RED before the fix, GREEN after
 *  - chromium-control: Chromium, iPhone 14  — GREEN before and after (control)
 *
 * This spec is excluded from the default `functional` (Desktop Chrome) project
 * to avoid running a redundant Chromium pass; the `chromium-control` project
 * serves that role on the same viewport.
 */
test('page-help sheet opens and stays open (not auto-dismissed)', async ({
	page,
}) => {
	await page.goto('/my-artists')

	// Click the `?` help trigger button to open the page-help sheet.
	// The `?` button renders in the page-header for all states (loading,
	// empty, populated), so no artist data is required.
	const helpBtn = page.getByRole('button', {
		name: /show help/i,
	})
	await expect(helpBtn).toBeVisible()
	await helpBtn.click()

	// Wait for the bottom-sheet popover to open.
	const popover = page.locator('bottom-sheet [popover]').first()
	await expect(popover).toBeVisible()

	// Sample :popover-open over ~1.5 s (15 × 100 ms intervals).
	// On the buggy build this fails within the first few samples because the
	// dismiss heuristics fire on the programmatic initial re-snap and close the
	// sheet before the user has interacted.
	const samples: boolean[] = []
	for (let i = 0; i < 15; i++) {
		await page.waitForTimeout(100)
		const isOpen = await popover.evaluate((el) => el.matches(':popover-open'))
		samples.push(isOpen)
	}

	// Every sample must be true — the popover must stay open the entire 1.5 s.
	for (const [i, isOpen] of samples.entries()) {
		expect(isOpen, `popover was not open at sample ${i + 1}`).toBe(true)
	}

	// Also verify that sheet CONTENT is visible, not merely the popover element.
	// If WebKit parks the scroll on the dismiss zone (ratio 0) after the
	// initial-snap, the sheet body would be off-screen while the popover is open.
	await expect(page.locator('.sheet-body')).toBeVisible()
})
