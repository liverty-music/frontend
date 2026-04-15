import { expect, type Page, test } from '@playwright/test'

/**
 * Settings push-notification toggle E2E.
 *
 * # Regression background
 *
 * Before this refactor (liverty-music/frontend#333), the toggle state was
 * cached in `localStorage.userNotificationsEnabled`. Enabling push from the
 * PostSignupDialog never wrote that flag, so the settings page showed OFF
 * even though the backend had the subscription. The fix derives the state
 * from `PushManager.getSubscription()` ∧ `PushNotificationService.Get`, with
 * self-heal via `Create` when the two diverge.
 *
 * # What this suite locks in
 *
 * Every test below maps to a scenario in the OpenSpec delta specs
 * (`openspec/changes/fix-push-notification-toggle-sync/specs/`) so that a
 * reviewer can confirm coverage at a glance:
 *
 * | Spec file             | Scenario                                        | Test case              |
 * |-----------------------|-------------------------------------------------|------------------------|
 * | settings              | "subscribed on this browser"                    | "toggle is ON ..."     |
 * | settings              | "not subscribed on this browser"                | "toggle is OFF ..."    |
 * | settings              | "self-heal on browser-present / backend-missing"| "self-heals to ON ..." |
 * | settings              | "toggle state is not cached in localStorage"    | "never writes the ..." |
 * | push-notification-... | "self-heal failure degrades to OFF"             | "stays OFF when ..."   |
 *
 * The toggle ON/OFF *click* actions are covered by the vitest unit suite
 * (`test/routes/settings-route.spec.ts`) — they are pure handler wiring
 * and gain no additional coverage from a real browser.
 *
 * # Why we stub PushManager and Notification.permission
 *
 * Real service-worker registration and the OS-level permission prompt are
 * orthogonal to the bug fix: the regression lives in the settings page's
 * *derivation logic*, not in the push-infrastructure plumbing. Stubbing the
 * two browser surfaces via `page.addInitScript` lets each test declare the
 * exact (browser, backend) state it wants to prove the settings page reacts
 * to, without flaky dependencies on browser permissions or HTTPS-only APIs.
 *
 * # Mock boundary contract
 *
 * The `installPushApiMocks` helper is the single source of truth for what
 * app code is allowed to read from the browser. Anything the app reads that
 * is NOT stubbed will hit real browser APIs and make tests flaky. Today
 * the app reads:
 *   - `Notification.permission` / `Notification.requestPermission`
 *   - `navigator.serviceWorker.ready` → `pushManager.getSubscription()`
 *   - `navigator.serviceWorker.ready` → `pushManager.subscribe()` (toggle-ON path)
 * If any of these change, update the mock in lockstep.
 */

const FAKE_ENDPOINT = 'https://push.example.com/e2e-endpoint'

/** Legacy localStorage key that the refactor removed. Must never be written. */
const LEGACY_TOGGLE_FLAG = 'user.notificationsEnabled'

// ---------------------------------------------------------------------------
// Browser API mocks
// ---------------------------------------------------------------------------

/**
 * Install a fake PushManager + `Notification.permission` in the page
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
			Object.defineProperty(Notification, 'permission', {
				configurable: true,
				get: () => perm,
			})
			Notification.requestPermission = async () =>
				perm as NotificationPermission

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

// ---------------------------------------------------------------------------
// Connect-RPC mocks
// ---------------------------------------------------------------------------

type GetResult = 'exists' | 'not-found'
type CreateResult = 'success' | 'server-error'

interface RpcMockHandle {
	/** Snapshot of Get-RPC invocation count. */
	getCalls(): number
	/** Snapshot of Create-RPC invocation count. */
	createCalls(): number
	/** Snapshot of Delete-RPC invocation count. */
	deleteCalls(): number
}

/**
 * Mock the Connect-RPC `PushNotificationService`. Returns a handle so tests
 * can assert call counts (e.g. "Get was NOT called when browser had no sub").
 */
async function mockPushRpc(
	page: Page,
	opts: { get: GetResult; create?: CreateResult } = { get: 'exists' },
): Promise<RpcMockHandle> {
	const counts = { get: 0, create: 0, delete: 0 }
	const createOutcome: CreateResult = opts.create ?? 'success'

	await page.route(
		'**/liverty_music.rpc.push_notification.**',
		async (route) => {
			const url = route.request().url()

			if (url.includes('/Get')) {
				counts.get += 1
				if (opts.get === 'not-found') {
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
				counts.create += 1
				if (createOutcome === 'server-error') {
					return route.fulfill({
						status: 500,
						contentType: 'application/json',
						headers: { 'grpc-status': '13', 'grpc-message': 'internal' },
						body: JSON.stringify({
							code: 'internal',
							message: 'simulated backend failure',
						}),
					})
				}
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
				counts.delete += 1
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

	return {
		getCalls: () => counts.get,
		createCalls: () => counts.create,
		deleteCalls: () => counts.delete,
	}
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that the legacy `user.notificationsEnabled` localStorage flag was
 * never written during the test. This locks in design decision D1 from
 * `openspec/changes/fix-push-notification-toggle-sync/design.md` — backend
 * DB is the single source of truth and the client keeps no cached flag.
 */
async function expectNoLegacyLocalStorageFlag(page: Page): Promise<void> {
	const value = await page.evaluate(
		(key) => localStorage.getItem(key),
		LEGACY_TOGGLE_FLAG,
	)
	expect(
		value,
		`Legacy localStorage flag "${LEGACY_TOGGLE_FLAG}" must never be written — it was removed in the refactor that made the backend the source of truth.`,
	).toBeNull()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Settings Push Notification Toggle', () => {
	test.use({ storageState: '.auth/storageState.json' })

	test('toggle is present on the settings page', async ({ page }) => {
		await page.goto('/settings')
		await page.waitForTimeout(3000)

		await expect(page.locator('text=Push Notifications')).toBeVisible()
		await expect(page.locator('button[role="switch"]')).toBeVisible()
	})

	test('toggle is OFF and no RPC is called when browser has no push subscription', async ({
		page,
	}) => {
		await installPushApiMocks(page, { hasBrowserSubscription: false })
		const rpc = await mockPushRpc(page, { get: 'exists' })

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toBeVisible()
		await expect(toggle).toHaveAttribute('aria-checked', 'false')

		// Spec: settings.md "not subscribed on this browser":
		// "the system SHALL NOT call PushNotificationService.Get for a non-existent endpoint"
		expect(rpc.getCalls()).toBe(0)
		expect(rpc.createCalls()).toBe(0)
		await expectNoLegacyLocalStorageFlag(page)
	})

	test('toggle is ON when browser subscription matches backend record', async ({
		page,
	}) => {
		await installPushApiMocks(page, { hasBrowserSubscription: true })
		const rpc = await mockPushRpc(page, { get: 'exists' })

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toHaveAttribute('aria-checked', 'true', {
			timeout: 10_000,
		})

		// Spec: settings.md "subscribed on this browser":
		// Get is consulted, self-heal Create is NOT triggered.
		expect(rpc.getCalls()).toBeGreaterThanOrEqual(1)
		expect(rpc.createCalls()).toBe(0)
		await expectNoLegacyLocalStorageFlag(page)
	})

	test('self-heals to ON when browser has subscription but backend returns NOT_FOUND', async ({
		page,
	}) => {
		// Exact shape of the original post-signup-dialog bug: the browser
		// holds an active subscription but the backend does not know about it
		// (previously because localStorage was the source of truth and the
		// dialog forgot to write the flag). The fix calls Create to re-register
		// and renders the toggle as ON without a permission prompt.
		await installPushApiMocks(page, { hasBrowserSubscription: true })
		const rpc = await mockPushRpc(page, {
			get: 'not-found',
			create: 'success',
		})

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toHaveAttribute('aria-checked', 'true', {
			timeout: 10_000,
		})

		expect(rpc.getCalls()).toBeGreaterThanOrEqual(1)
		expect(rpc.createCalls()).toBeGreaterThanOrEqual(1)
		await expectNoLegacyLocalStorageFlag(page)
	})

	test('stays OFF when self-heal Create fails after Get returned NOT_FOUND', async ({
		page,
	}) => {
		// Spec: push-notification-service.md "Self-heal failure degrades to OFF":
		// When Create errors the UI must fall back to OFF (do NOT optimistically
		// show ON, since the subscription is demonstrably not registered).
		await installPushApiMocks(page, { hasBrowserSubscription: true })
		const rpc = await mockPushRpc(page, {
			get: 'not-found',
			create: 'server-error',
		})

		await page.goto('/settings')

		const toggle = page.locator('button[role="switch"]').first()
		await expect(toggle).toBeVisible()

		// The initial toggle value is also "false", so a bare aria-checked
		// assertion could pass BEFORE the self-heal attempt completes. Wait
		// for the self-heal Create to actually be attempted first — only then
		// is the "stays OFF" assertion meaningful (did the failed attempt
		// correctly decline to flip the toggle to ON?).
		await expect
			.poll(() => rpc.createCalls(), {
				message:
					'self-heal Create must be attempted before we can assert the failure outcome',
				timeout: 10_000,
			})
			.toBeGreaterThanOrEqual(1)

		await expect(toggle).toHaveAttribute('aria-checked', 'false')

		expect(rpc.getCalls()).toBeGreaterThanOrEqual(1)
		await expectNoLegacyLocalStorageFlag(page)
	})
})
