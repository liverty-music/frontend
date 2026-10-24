import { IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Snack } from '../../shared/ui/snack-bar/snack'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import { IAuthService } from '../../src/services/auth-service'
import { INotificationManager } from '../../src/services/notification-manager'
import {
	IPushOfferService,
	type PushOfferService,
} from '../../src/services/push-offer-service'
import { IPushService } from '../../src/services/push-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockLocalStorage } from '../helpers/mock-local-storage'

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
	let auth: { isAuthenticated: boolean }
	let notifications: { permission: NotificationPermission }
	let push: { create: ReturnType<typeof vi.fn> }
	let storage: ReturnType<typeof createMockLocalStorage>
	let snacks: Snack[]
	/** The answer the browser prompt gives when `create()` asks for permission. */
	let answer: NotificationPermission

	/** A new app launch on the same browser (storage survives). */
	function launch(): PushOfferService {
		snacks = []
		const container = createTestContainer(
			Registration.instance(IAuthService, auth),
			Registration.instance(INotificationManager, notifications),
			Registration.instance(IPushService, push),
			Registration.instance(ILocalStorage, storage),
			Registration.instance(IEventAggregator, {
				publish: (e: unknown) => {
					if (e instanceof Snack) snacks.push(e)
				},
			}),
			Registration.instance(IAnalyticsService, { capture: vi.fn() }),
		)
		return container.get(IPushOfferService)
	}

	/** Show the offer and close the snack without pressing its action. */
	function leaveUnanswered(sut: PushOfferService): void {
		sut.offer('offer')
		snacks.at(-1)?.options?.onDismiss?.()
	}

	/** Show the offer and press its action. */
	async function press(sut: PushOfferService): Promise<void> {
		sut.offer('offer')
		const snack = snacks.at(-1)
		snack?.options?.action?.callback()
		snack?.options?.onDismiss?.()
		await vi.waitFor(() => expect(push.create).toHaveBeenCalled())
		await Promise.resolve()
	}

	beforeEach(() => {
		givePushSupport()
		auth = { isAuthenticated: true }
		notifications = { permission: 'default' }
		answer = 'granted'
		push = {
			create: vi.fn(async () => {
				notifications.permission = answer
				return answer === 'granted' ? 'endpoint' : null
			}),
		}
		storage = createMockLocalStorage()
	})

	afterEach(() => {
		removePushSupport()
	})

	describe('eligibility', () => {
		it('offers to a signed-in fan with an undecided permission', () => {
			expect(launch().shouldOffer()).toBe(true)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Guest"
		it('never offers to a guest', () => {
			auth.isAuthenticated = false
			expect(launch().shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission already granted"
		it('does not offer once the browser allows notifications', () => {
			notifications.permission = 'granted'
			expect(launch().shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Permission blocked"
		it('does not offer once the browser blocked notifications', () => {
			notifications.permission = 'denied'
			expect(launch().shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "iOS Safari without the app on the home screen"
		it('does not offer where the browser exposes no Notification API', () => {
			// iOS Safari outside a home-screen app has no Notification API.
			delete (globalThis as Record<string, unknown>).Notification
			expect(launch().shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "No browser prompt on launch"
		it('neither asks the browser nor shows an offer on launch', () => {
			launch()
			expect(push.create).not.toHaveBeenCalled()
			expect(snacks).toHaveLength(0)
		})
	})

	describe('limits', () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Once per session"
		it('offers at most once per launch', () => {
			const sut = launch()
			sut.offer('offer')

			expect(sut.shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Next session"
		it('offers again on the next launch after one unanswered offer', () => {
			leaveUnanswered(launch())

			expect(launch().shouldOffer()).toBe(true)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Third unanswered offer stops it"
		it('stops for good after 3 unanswered or declined offers', async () => {
			leaveUnanswered(launch())
			leaveUnanswered(launch())
			answer = 'default'
			await press(launch())
			expect(storage.getItem('push.offerDeclines')).toBe('3')
			notifications.permission = 'default'

			expect(launch().shouldOffer()).toBe(false)
		})

		it('does not count a pressed offer as unanswered', async () => {
			await press(launch())
			expect(storage.getItem('push.offerDeclines')).toBeNull()
		})
	})

	describe('pressing the action', () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Pressing the offer action shows the browser prompt"
		it('asks the browser at once, within the press', () => {
			const sut = launch()
			sut.offer('offer')

			snacks[0].options?.action?.callback()

			// Synchronously inside the press handler, so the prompt follows the
			// gesture; the answer is reported as started by the notification prompt.
			expect(push.create).toHaveBeenCalledTimes(1)
			expect(push.create).toHaveBeenCalledWith('notification_prompt')
		})

		it('offers with the 「オンにする」 action for 10 seconds', () => {
			const sut = launch()
			sut.offer(
				'ヨルシカを Away にしました。新着ライブを通知で受け取りますか？',
			)

			expect(snacks[0].message).toBe(
				'ヨルシカを Away にしました。新着ライブを通知で受け取りますか？',
			)
			expect(snacks[0].action?.label).toBe('pushOffer.action')
			expect(snacks[0].durationMs).toBe(10_000)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan allows"
		it('registers push and confirms when the fan allows', async () => {
			await press(launch())

			expect(push.create).toHaveBeenCalledTimes(1)
			expect(snacks.at(-1)?.message).toBe('pushOffer.allowed')
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan blocks"
		it('says notifications are blocked and stops offering', async () => {
			answer = 'denied'
			const sut = launch()
			await press(sut)

			expect(snacks.at(-1)?.message).toBe('pushOffer.blocked')
			expect(launch().shouldOffer()).toBe(false)
		})

		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan closes the prompt"
		it('shows nothing and counts one unanswered offer when the prompt is closed', async () => {
			answer = 'default'
			await press(launch())

			expect(snacks).toHaveLength(1) // the offer itself
			expect(storage.getItem('push.offerDeclines')).toBe('1')
		})

		it('does not count a prompt closed from the post-signup sheet', async () => {
			answer = 'default'
			await launch().accept({ source: 'post_signup_dialog', counted: false })

			expect(storage.getItem('push.offerDeclines')).toBeNull()
		})

		it('says it failed when registering push fails', async () => {
			push.create.mockRejectedValueOnce(new Error('rpc'))
			await launch().accept({ source: 'notification_prompt', counted: true })

			expect(snacks.at(-1)?.message).toBe('pushOffer.failed')
			expect(snacks.at(-1)?.severity).toBe('error')
		})
	})
})
