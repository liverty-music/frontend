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
	// Mark the page help as already seen. On a first visit the sheet
	// auto-opens, which leaves the `?` trigger in a state this spec does not
	// exercise — the regression under test is the sheet closing itself after a
	// USER opens it. Seeding this makes the run deterministic and starts the
	// page with the sheet closed. (Key: `saveHelpSeen()` in
	// `src/adapter/storage/onboarding-storage.ts`.)
	await page.addInitScript(() => {
		localStorage.setItem('liverty:onboarding:helpSeen:my-artists', '1')
	})

	await page.goto('/my-artists')

	// Open the page-help sheet from the FAB launcher. The help trigger used to
	// be a `?` button in the page-header; it now lives in the FAB menu
	// (`helpAction()` in `src/services/fab-menu-service.ts`, registered by
	// `my-artists-route.ts`). The FAB renders for all route states (loading,
	// empty, populated), so no artist data is required.
	const fabToggle = page.locator('fab-menu .fab-toggle')
	await expect(fabToggle).toBeVisible()
	await fabToggle.click()

	const helpBtn = page.locator('fab-menu [data-action-id="help"]')
	await expect(helpBtn).toBeVisible()
	await helpBtn.click()

	// Wait for the bottom-sheet popover to open. Scope every locator to
	// <page-help>: other components mount their own <bottom-sheet> (error-banner
	// does), so a bare `.sheet-body` / `[popover]` selector matches more than one
	// element and resolves to whichever happens to come first in the DOM.
	const popover = page.locator('page-help bottom-sheet [popover]').first()
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
	await expect(page.locator('page-help .sheet-body')).toBeVisible()
})
