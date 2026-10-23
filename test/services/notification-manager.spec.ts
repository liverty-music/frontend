import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	Events,
	IAnalyticsService,
} from '../../src/lib/analytics/analytics-service'
import { INotificationManager } from '../../src/services/notification-manager'
import { createMockAnalytics } from '../helpers/mock-analytics'
import { createMockLogger } from '../helpers/mock-logger'

describe('NotificationManager.requestPermission', () => {
	let analytics: ReturnType<typeof createMockAnalytics>

	/** A browser whose permission starts at `start` and answers `answer`. */
	function stubNotification(
		start: NotificationPermission,
		answer: NotificationPermission,
	): void {
		const notification = {
			permission: start,
			requestPermission: vi.fn(async () => {
				notification.permission = answer
				return answer
			}),
		}
		vi.stubGlobal('Notification', notification)
	}

	function create(): INotificationManager {
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(Registration.instance(IAnalyticsService, analytics))
		return container.get(INotificationManager)
	}

	beforeEach(() => {
		analytics = createMockAnalytics()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('reports a denied answer with where the request started', async () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan denies"
		stubNotification('default', 'denied')
		const sut = create()

		await expect(sut.requestPermission('notification_prompt')).resolves.toBe(
			'denied',
		)

		expect(analytics.capture.mock.calls).toEqual([
			[
				Events.NotificationPermissionResult,
				{ answer: 'denied', source: 'notification_prompt' },
			],
		])
	})

	it('reports a request closed without an answer as dismissed', async () => {
		stubNotification('default', 'default')
		const sut = create()

		await sut.requestPermission('settings')

		expect(analytics.capture).toHaveBeenCalledWith(
			Events.NotificationPermissionResult,
			{ answer: 'dismissed', source: 'settings' },
		)
	})

	it('reports nothing when the browser did not ask (already decided)', async () => {
		stubNotification('granted', 'granted')
		const sut = create()

		await sut.requestPermission('settings')

		expect(analytics.capture).not.toHaveBeenCalled()
	})

	it('reports nothing for a request the app started itself', async () => {
		stubNotification('default', 'granted')
		const sut = create()

		await sut.requestPermission(null)

		expect(analytics.capture).not.toHaveBeenCalled()
	})
})
