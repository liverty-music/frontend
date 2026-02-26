import { expect, test } from '@playwright/test'

// The dashboard requires auth or onboarding step >= 3.
// Set onboarding step and region to bypass auth and region-setup dialog.
const ONBOARDING_SETUP = () => {
	localStorage.setItem('liverty:onboardingStep', '3')
	localStorage.setItem('liverty-music:user-region', 'Tokyo')
}

test.describe('PWA Install Prompt', () => {
	test('does not show banner on first session', async ({ page }) => {
		await page.addInitScript(ONBOARDING_SETUP)
		await page.goto('/dashboard')
		await page.waitForTimeout(2000)
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()
	})

	test('shows banner on second session when beforeinstallprompt fires', async ({
		page,
	}) => {
		await page.addInitScript(ONBOARDING_SETUP)
		await page.addInitScript(() => {
			// Set session count to 1; PwaInstallService constructor increments to 2
			localStorage.setItem('liverty-music:session-count', '1')
		})

		await page.goto('/dashboard')
		await page.waitForTimeout(2000)

		// Dispatch beforeinstallprompt after Aurelia has booted
		await page.evaluate(() => {
			const event = new Event('beforeinstallprompt', { cancelable: true })
			Object.assign(event, {
				prompt: () => Promise.resolve(),
				userChoice: Promise.resolve({ outcome: 'dismissed' }),
			})
			window.dispatchEvent(event)
		})

		await expect(page.getByTestId('pwa-install-banner')).toBeVisible({
			timeout: 5000,
		})
	})

	test('dismiss hides banner and persists', async ({ page }) => {
		await page.addInitScript(ONBOARDING_SETUP)
		await page.addInitScript(() => {
			localStorage.setItem('liverty-music:session-count', '1')
		})

		await page.goto('/dashboard')
		await page.waitForTimeout(2000)

		await page.evaluate(() => {
			const event = new Event('beforeinstallprompt', { cancelable: true })
			Object.assign(event, {
				prompt: () => Promise.resolve(),
				userChoice: Promise.resolve({ outcome: 'dismissed' }),
			})
			window.dispatchEvent(event)
		})

		await expect(page.getByTestId('pwa-install-banner')).toBeVisible({
			timeout: 5000,
		})

		await page.getByTestId('pwa-install-dismiss').click()
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()

		const dismissed = await page.evaluate(() =>
			localStorage.getItem('liverty-music:install-prompt-dismissed'),
		)
		expect(dismissed).toBe('true')
	})

	test('install button triggers deferred prompt', async ({ page }) => {
		await page.addInitScript(ONBOARDING_SETUP)
		await page.addInitScript(() => {
			localStorage.setItem('liverty-music:session-count', '1')
		})

		await page.goto('/dashboard')
		await page.waitForTimeout(2000)

		await page.evaluate(() => {
			;(window as unknown as { __pwaPromptCalled: boolean }).__pwaPromptCalled = false
			const event = new Event('beforeinstallprompt', { cancelable: true })
			Object.assign(event, {
				prompt: () => {
					;(window as unknown as { __pwaPromptCalled: boolean }).__pwaPromptCalled = true
					return Promise.resolve()
				},
				userChoice: Promise.resolve({ outcome: 'accepted' }),
			})
			window.dispatchEvent(event)
		})

		await expect(page.getByTestId('pwa-install-banner')).toBeVisible({
			timeout: 5000,
		})

		await page.getByTestId('pwa-install-button').click()

		const promptCalled = await page.evaluate(
			() =>
				(window as unknown as { __pwaPromptCalled: boolean })
					.__pwaPromptCalled ?? false,
		)
		expect(promptCalled).toBe(true)

		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()
	})
})
