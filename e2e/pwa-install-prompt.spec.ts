import { expect, test } from '@playwright/test'

test.describe('PWA Install Prompt', () => {
	test.beforeEach(async ({ page }) => {
		// Clear localStorage to start fresh
		await page.addInitScript(() => {
			localStorage.removeItem('liverty-music:session-count')
			localStorage.removeItem('liverty-music:install-prompt-dismissed')
		})
	})

	test('does not show banner on first session', async ({ page }) => {
		await page.goto('/dashboard')
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()
	})

	test('shows banner on second session when beforeinstallprompt fires', async ({
		page,
	}) => {
		// Simulate second session
		await page.addInitScript(() => {
			localStorage.setItem('liverty-music:session-count', '1')
		})

		// Intercept and defer the beforeinstallprompt event
		await page.addInitScript(() => {
			window.addEventListener('load', () => {
				const event = new Event('beforeinstallprompt', {
					cancelable: true,
				}) as Event & {
					prompt: () => Promise<void>
					userChoice: Promise<{ outcome: string }>
				}
				event.prompt = () => Promise.resolve()
				event.userChoice = Promise.resolve({ outcome: 'dismissed' })
				window.dispatchEvent(event)
			})
		})

		await page.goto('/dashboard')
		await expect(page.getByTestId('pwa-install-banner')).toBeVisible()
	})

	test('dismiss hides banner and persists', async ({ page }) => {
		// Simulate second session + beforeinstallprompt
		await page.addInitScript(() => {
			localStorage.setItem('liverty-music:session-count', '1')
			window.addEventListener('load', () => {
				const event = new Event('beforeinstallprompt', {
					cancelable: true,
				}) as Event & {
					prompt: () => Promise<void>
					userChoice: Promise<{ outcome: string }>
				}
				event.prompt = () => Promise.resolve()
				event.userChoice = Promise.resolve({ outcome: 'dismissed' })
				window.dispatchEvent(event)
			})
		})

		await page.goto('/dashboard')
		await expect(page.getByTestId('pwa-install-banner')).toBeVisible()

		// Click dismiss
		await page.getByTestId('pwa-install-dismiss').click()
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()

		// Verify localStorage persisted
		const dismissed = await page.evaluate(() =>
			localStorage.getItem('liverty-music:install-prompt-dismissed'),
		)
		expect(dismissed).toBe('true')

		// Reload — banner should not reappear
		await page.reload()
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()
	})

	test('install button triggers deferred prompt', async ({ page }) => {
		let promptCalled = false

		await page.addInitScript(() => {
			localStorage.setItem('liverty-music:session-count', '1')
			window.addEventListener('load', () => {
				const event = new Event('beforeinstallprompt', {
					cancelable: true,
				}) as Event & {
					prompt: () => Promise<void>
					userChoice: Promise<{ outcome: string }>
				}
				event.prompt = () => {
					;(window as unknown as { __pwaPromptCalled: boolean }).__pwaPromptCalled = true
					return Promise.resolve()
				}
				event.userChoice = Promise.resolve({ outcome: 'accepted' })
				window.dispatchEvent(event)
			})
		})

		await page.goto('/dashboard')
		await expect(page.getByTestId('pwa-install-banner')).toBeVisible()

		await page.getByTestId('pwa-install-button').click()

		promptCalled = await page.evaluate(
			() => (window as unknown as { __pwaPromptCalled: boolean }).__pwaPromptCalled ?? false,
		)
		expect(promptCalled).toBe(true)

		// Banner should be hidden after install
		await expect(
			page.getByTestId('pwa-install-banner'),
		).not.toBeVisible()
	})
})
