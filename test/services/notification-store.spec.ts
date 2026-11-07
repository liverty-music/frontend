import { IEventAggregator, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INotificationRpcClient } from '../../src/adapter/rpc/client/notification-client'
import type { Notification } from '../../src/entities/notification'
import { IAuthService } from '../../src/services/auth-service'
import { SignedOut } from '../../src/services/events/signed-out'
import { NotificationStore } from '../../src/services/notification-store'
import { createTestContainer } from '../helpers/create-container'

function notification(id: string, read = false): Notification {
	return {
		id,
		title: `[A] ${id}`,
		body: 'body',
		link: '/tickets',
		createTime: new Date('2026-11-07T00:00:00Z'),
		readTime: read ? new Date('2026-11-07T01:00:00Z') : undefined,
	}
}

describe('NotificationStore', () => {
	let rpc: {
		list: ReturnType<typeof vi.fn>
		markRead: ReturnType<typeof vi.fn>
	}
	let auth: { isAuthenticated: boolean }

	function build() {
		const container = createTestContainer(
			Registration.instance(INotificationRpcClient, rpc),
			Registration.instance(IAuthService, auth),
		)
		container.register(NotificationStore)
		return {
			store: container.get(NotificationStore),
			ea: container.get(IEventAggregator),
		}
	}

	beforeEach(() => {
		rpc = {
			list: vi.fn(async () => [notification('a'), notification('b', true)]),
			markRead: vi.fn(async () => {}),
		}
		auth = { isAuthenticated: true }
	})

	it('counts the unread notifications of the last list', async () => {
		const { store } = build()

		await store.refresh()

		expect(store.state).toBe('ready')
		expect(store.notifications).toHaveLength(2)
		expect(store.unreadCount).toBe(1)
	})

	it('reads nothing for a guest', async () => {
		auth.isAuthenticated = false
		const { store } = build()

		await store.refresh()

		expect(rpc.list).not.toHaveBeenCalled()
		expect(store.unreadCount).toBe(0)
	})

	it('keeps the previous list when a refresh fails', async () => {
		const { store } = build()
		await store.refresh()
		rpc.list.mockRejectedValueOnce(new Error('network'))

		await store.refresh()

		expect(store.state).toBe('error')
		expect(store.notifications).toHaveLength(2)
	})

	it('lets a newer refresh win over an older one still in flight', async () => {
		const { store } = build()
		let answerOlder: (v: Notification[]) => void = () => {}
		rpc.list.mockImplementationOnce(
			() => new Promise((resolve) => (answerOlder = resolve)),
		)
		rpc.list.mockResolvedValueOnce([notification('newer')])

		const older = store.refresh()
		await store.refresh()
		answerOlder([notification('older')])
		await older

		expect(store.notifications.map((n) => n.id)).toEqual(['newer'])
	})

	it('marks read optimistically and refreshes', async () => {
		const { store } = build()
		await store.refresh()
		let answer: () => void = () => {}
		rpc.markRead.mockImplementationOnce(
			() => new Promise<void>((resolve) => (answer = resolve)),
		)
		rpc.list.mockResolvedValueOnce([
			notification('a', true),
			notification('b', true),
		])

		const marking = store.markRead('a')
		expect(store.unreadCount).toBe(0)
		answer()
		await marking

		expect(rpc.markRead).toHaveBeenCalledWith('a')
		expect(rpc.list).toHaveBeenCalledTimes(2)
		expect(store.unreadCount).toBe(0)
	})

	// @spec components/infrastructure/fan/web/global/service-worker "Marking fails"
	it('rolls back without rejecting when marking fails', async () => {
		const { store } = build()
		await store.refresh()
		rpc.markRead.mockRejectedValueOnce(new Error('network'))

		await expect(store.markRead('a')).resolves.toBeUndefined()

		expect(store.unreadCount).toBe(1)
	})

	it('forgets the notifications on sign-out', async () => {
		const { store, ea } = build()
		await store.refresh()

		ea.publish(new SignedOut())

		expect(store.notifications).toEqual([])
		expect(store.unreadCount).toBe(0)
	})
})
