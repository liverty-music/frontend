import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import { INotificationManager } from '../../src/services/notification-manager'
import {
	IPushOfferService,
	type PushOfferService,
} from '../../src/services/push-offer-service'
import { IPushService } from '../../src/services/push-service'
import { createTestContainer } from '../helpers/create-container'

/** Browser globals that make push available, removed after each test. */
function givePushSupport(): void {
	;(globalThis as Record<string, unknown>).Notification = class {}
	;(globalThis as Record<string, unknown>).PushManager = class {}
	Object.defineProperty(navigator, 'serviceWorker', {
		configurable: true,
		value: {},
	})
}

function removePushSupport(): void {
	delete (globalThis as Record<string, unknown>).Notification
	delete (globalThis as Record<string, unknown>).PushManager
	delete (navigator as unknown as Record<string, unknown>).serviceWorker
}

describe('PushOfferService', () => {
	let notifications: { permission: NotificationPermission }
	let push: {
		create: ReturnType<typeof vi.fn>
		getBrowserSubscription: ReturnType<typeof vi.fn>
	}
	let snacks: Snack[]
	/** The answer the browser prompt gives when `create()` asks for permission. */
	let answer: NotificationPermission
	/** Whether this browser holds a push subscription. */
	let registered: boolean

	function create(): PushOfferService {
		snacks = []
		const container = createTestContainer(
			Registration.instance(INotificationManager, notifications),
			Registration.instance(IPushService, push),
			Registration.instance(IEventAggregator, {
				publish: (e: unknown) => {
					if (e instanceof Snack) snacks.push(e)
				},
			}),
			Registration.instance(IAnalyticsService, { capture: vi.fn() }),
		)
		return container.get(IPushOfferService)
	}

	beforeEach(() => {
		givePushSupport()
		notifications = { permission: 'default' }
		answer = 'granted'
		registered = false
		push = {
			create: vi.fn(async () => {
				// The browser asks only while the permission is undecided.
				if (notifications.permission === 'default') {
					notifications.permission = answer
				}
				if (notifications.permission !== 'granted') return null
				registered = true
				return 'endpoint'
			}),
			getBrowserSubscription: vi.fn(async () =>
				registered ? { endpoint: 'endpoint', p256dh: 'p', auth: 'a' } : null,
			),
		}
	})

	afterEach(() => {
		removePushSupport()
	})

	describe('pushState', () => {
		it('is offerable while the permission is undecided', async () => {
			await expect(create().pushState()).resolves.toBe('offerable')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission already granted"
		it('is on when notifications are allowed and this browser is registered', async () => {
			notifications.permission = 'granted'
			registered = true

			await expect(create().pushState()).resolves.toBe('on')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission granted but this browser not registered"
		it('is offerable when allowed but not registered, and the offer registers without a prompt', async () => {
			notifications.permission = 'granted'
			const sut = create()

			await expect(sut.pushState()).resolves.toBe('offerable')
			await sut.accept({ source: 'notification_prompt' })

			expect(push.create).toHaveBeenCalledWith('notification_prompt')
			await expect(sut.pushState()).resolves.toBe('on')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission blocked"
		it('links to Settings once the browser blocked notifications', async () => {
			notifications.permission = 'denied'

			await expect(create().pushState()).resolves.toBe('settings')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "iOS Safari without the app on the home screen"
		it('links to Settings where the browser exposes no Notification API', async () => {
			// iOS Safari outside a home-screen app has no Notification API.
			delete (globalThis as Record<string, unknown>).Notification

			await expect(create().pushState()).resolves.toBe('settings')
		})

		it('is offerable when the subscription cannot be read', async () => {
			notifications.permission = 'granted'
			push.getBrowserSubscription.mockRejectedValueOnce(
				new Error('Service Worker ready timed out'),
			)

			await expect(create().pushState()).resolves.toBe('offerable')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "No browser prompt on launch"
		it('neither asks the browser nor shows a snack on its own', async () => {
			await create().pushState()

			expect(push.create).not.toHaveBeenCalled()
			expect(snacks).toHaveLength(0)
		})
	})

	describe('no limit on the in-context offers', () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Every hype change with push off"
		// @spec components/infrastructure/fan/web/global/notification-prompt "After several unanswered offers"
		it('stays offerable after any number of unanswered offers', async () => {
			answer = 'default'
			const sut = create()
			for (let i = 0; i < 5; i++) {
				await sut.accept({ source: 'notification_prompt' })
				await expect(sut.pushState()).resolves.toBe('offerable')
			}
		})
	})

	describe('accept', () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Pressing the offer action shows the browser prompt"
		it('asks the browser at once, within the press', () => {
			void create().accept({ source: 'event_detail_sheet' })

			// Synchronously inside the press handler, so the prompt follows the
			// gesture; the answer is reported with where the request started.
			expect(push.create).toHaveBeenCalledTimes(1)
			expect(push.create).toHaveBeenCalledWith('event_detail_sheet')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan allows"
		it('registers push and confirms when the fan allows', async () => {
			const sut = create()
			await expect(sut.accept({ source: 'notification_prompt' })).resolves.toBe(
				'granted',
			)

			expect(snacks.at(-1)?.message).toBe('pushOffer.allowed')
			await expect(sut.pushState()).resolves.toBe('on')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan blocks"
		it('says notifications are blocked and offers no more', async () => {
			answer = 'denied'
			const sut = create()
			await sut.accept({ source: 'notification_prompt' })

			expect(snacks.at(-1)?.message).toBe('pushOffer.blocked')
			await expect(sut.pushState()).resolves.toBe('settings')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan closes the prompt"
		it('shows nothing when the prompt is closed', async () => {
			answer = 'default'
			await create().accept({ source: 'notification_prompt' })

			expect(snacks).toHaveLength(0)
		})

		it('leaves a block or failure to an inline caller', async () => {
			answer = 'denied'
			await create().accept({ source: 'post_signup_dialog', inline: true })

			expect(snacks).toHaveLength(0)
		})

		it('says it failed when registering push fails', async () => {
			push.create.mockRejectedValueOnce(new Error('rpc'))
			await create().accept({ source: 'notification_prompt' })

			expect(snacks.at(-1)?.message).toBe('pushOffer.failed')
			expect(snacks.at(-1)?.severity).toBe('error')
		})
	})
})
