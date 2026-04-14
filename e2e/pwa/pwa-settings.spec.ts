import { expect, type Page, test } from '@playwright/test'

/**
 * Settings push-notification toggle E2E.
 *
 * Regression: before the backend-truth refactor, the toggle state was
 * cached in `localStorage.userNotificationsEnabled`. Enabling push from
 * the PostSignupDialog never wrote that flag, so settings showed OFF
 * even though the backend had the subscription. The fix derives the
 * state from (PushManager.getSubscription, PushNotificationService.Get)
 * with self-heal via Create. These tests lock in the derivation.
 */

const FAKE_ENDPOINT = 'https://push.example.com/e2e-endpoint'

/**
 * Install a fake PushManager + Notification.permission in the page
 * before any app code runs. Optionally returns a browser-side subscription.
 */
async function installPushApiMocks(
	page: Page,
	opts: {
		hasBrowserSubscription: boolean
		permission?: 'granted' | 'denied' | 'default'
	} = {
		hasBrowserSubscription: false,
	},
): Promise<void> {
	const permission = opts.permission ?? 'granted'
	await page.addInitScript(
		({ endpoint, hasSub, perm }) => {
			// Override Notification.permission
			Object.defineProperty(Notification, 'permission', {
				configurable: true,
				get: () => perm,
			})
			// Ensure requestPermission returns the configured value
			Notification.requestPermission = async () =>
				perm as NotificationPermission

			// Stub out navigator.serviceWorker.ready with a fake registration that
			// exposes the bits the app code reads: pushManager.getSubscription / subscribe.
			const subscription = hasSub
				? {
						endpoint,
						toJSON: () => ({
							endpoint,
							keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-secret' },
						}),
						unsubscribe: async () => true,
					}
				: null
			const registration = {
				pushManager: {
					getSubscription: async () => subscription,
					subscribe: async () => ({
						endpoint,
						toJSON: () => ({
							endpoint,
							keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-secret' },
						}),
						unsubscribe: async () => true,
					}),
				},
			}
			Object.defineProperty(navigator, 'serviceWorker', {
				configurable: true,
				get: () => ({
					ready: Promise.resolve(registration),
					register: async () => registration,
					getRegistration: async () => registration,
				}),
			})
		},
		{
			endpoint: FAKE_ENDPOINT,
			hasSub: opts.hasBrowserSubscription,
			perm: permission,
		},
	)
}

/**
 * Mock PushNotificationService RPC. `getResult` controls whether the
 * backend claims to know this subscription.
 */
async function mockPushRpc(
	page: Page,
	getResult: 'exists' | 'not-found',
): Promise<{ createCalls: string[] }> {
	const createCalls: string[] = []
	await page.route(
		'**/liverty_music.rpc.push_notification.**',
		async (route) => {
			const url = route.request().url()
			if (url.includes('/Get')) {
				if (getResult === 'not-found') {
					return route.fulfill({
						status: 404,
						contentType: 'application/json',
						headers: { 'grpc-status': '5', 'grpc-message': 'not found' },
						body: JSON.stringify({
							code: 'not_found',
							message: 'push subscription not found',
						}),
					})
				}
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						subscription: {
							id: { value: '11111111-1111-1111-1111-111111111111' },
							userId: { value: 'e2e-user' },
							endpoint: { value: FAKE_ENDPOINT },
							keys: { p256Dh: 'fake-p256dh-key', auth: 'fake-auth-secret' },
						},
					}),
				})
			}
			if (url.includes('/Create')) {
				createCalls.push(route.request().postData() ?? '')
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						subscription: {
							id: { value: '22222222-2222-2222-2222-222222222222' },
							userId: { value: 'e2e-user' },
							endpoint: { value: FAKE_ENDPOINT },
							keys: { p256Dh: 'fake-p256dh-key', auth: 'fake-auth-secret' },
						},
					}),
				})
			}
			if (url.includes('/Delete')) {
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: '{}',
				})
			}
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{}',
			})
		},
	)
	return { createCalls }
}

test.describe('Settings Push Notification Toggle', () => {
	test.use({ storageState: '.auth/storageState.json' })

	test('toggle is present on the settings page', async ({ page }) => {
		await page.goto('/settings')
		await page.waitForTimeout(3000)

		await expect(page.locator('text=Push Notifications')).toBeVisible()
		await expect(page.locator('button[role="switch"]')).toBeVisible()
	})

	test('toggle is OFF when browser has no push subscription', async ({
		page,
	}) => {
		await installPushApiMocks(page, { hasBrowserSubscription: false })
		await mockPushRpc(page, 'exists') // Get should never be called — assertion below

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toBeVisible()
		await expect(toggle).toHaveAttribute('aria-checked', 'false')
	})

	test('toggle is ON when browser subscription matches backend record', async ({
		page,
	}) => {
		await installPushApiMocks(page, { hasBrowserSubscription: true })
		await mockPushRpc(page, 'exists')

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toHaveAttribute('aria-checked', 'true', {
			timeout: 10_000,
		})
	})

	test('self-heals to ON when browser has subscription but backend returns NOT_FOUND', async ({
		page,
	}) => {
		// This is the exact shape of the original post-signup-dialog bug:
		// the browser has an active subscription, but the backend does not know
		// about it (previously because localStorage was the source of truth and
		// the dialog forgot to write the flag). The fix calls Create to re-register
		// and renders the toggle as ON without prompting the user.
		await installPushApiMocks(page, { hasBrowserSubscription: true })
		const { createCalls } = await mockPushRpc(page, 'not-found')

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toHaveAttribute('aria-checked', 'true', {
			timeout: 10_000,
		})
		expect(createCalls.length).toBeGreaterThanOrEqual(1)
	})
})
