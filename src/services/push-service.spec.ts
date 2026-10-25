import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockLogger = {
	scopeTo: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}

const mockRpc = {
	create: vi.fn(async () => ({})),
	get: vi.fn(async () => ({})),
	delete: vi.fn(async () => undefined),
}

const mockNotificationManager: {
	permission: NotificationPermission
	requestPermission: ReturnType<typeof vi.fn>
} = {
	permission: 'granted',
	requestPermission: vi.fn(async () => mockNotificationManager.permission),
}

const mockAppConfig = { vapidPublicKey: 'BNg-test-key' }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		ILogger: { friendlyName: 'ILogger' },
		resolve: (token: { friendlyName?: string }) => {
			switch (token?.friendlyName) {
				case 'ILogger':
					return mockLogger
				case 'IPushSubscriptionRpcClient':
					return mockRpc
				case 'INotificationManager':
					return mockNotificationManager
				case 'IAppConfig':
					return mockAppConfig
				default:
					return undefined
			}
		},
	}
})

vi.mock('../adapter/rpc/client/push-subscription-client', () => ({
	IPushSubscriptionRpcClient: { friendlyName: 'IPushSubscriptionRpcClient' },
}))
vi.mock('../config/app-config', () => ({
	IAppConfig: { friendlyName: 'IAppConfig' },
}))
vi.mock('./notification-manager', () => ({
	INotificationManager: { friendlyName: 'INotificationManager' },
}))

import { PushServiceClient } from './push-service'

// ── Service Worker registration stub ─────────────────────────────────────────

const pushManager = {
	getSubscription: vi.fn(),
	subscribe: vi.fn(),
}

function browserSub(endpoint: string) {
	return {
		toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
		unsubscribe: vi.fn(async () => true),
	}
}

function notFound(): ConnectError {
	return new ConnectError('missing', Code.NotFound)
}

beforeEach(() => {
	vi.clearAllMocks()
	mockNotificationManager.permission = 'granted'
	pushManager.getSubscription.mockResolvedValue(null)
	pushManager.subscribe.mockResolvedValue(browserSub('https://push/new'))
	vi.stubGlobal('navigator', {
		serviceWorker: { ready: Promise.resolve({ pushManager }) },
	})
})

describe('PushServiceClient.resolvePushState (recovery matrix)', () => {
	// @spec components/infrastructure/fan/web/global/app-shell "Permission not granted"
	it('permission not granted → needs-permission, no RPC calls', async () => {
		mockNotificationManager.permission = 'default'
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('needs-permission')
		expect(mockRpc.get).not.toHaveBeenCalled()
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	it('granted + browser sub already registered on backend → enabled, no re-register', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockResolvedValue({ subscription: {} })
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('enabled')
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	// @spec components/infrastructure/fan/web/global/app-shell "Server lost the subscription"
	it('granted + browser sub missing on backend → self-heal via Create → enabled', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockRejectedValue(notFound())
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('enabled')
		// The subscription is looked up by its endpoint alone: no user id.
		expect(mockRpc.get).toHaveBeenCalledWith('https://push/x')
		expect(mockRpc.create).toHaveBeenCalledTimes(1)
	})

	it('does not ask the backend before the account is loaded', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(false)).resolves.toBe('enabled')
		expect(mockRpc.get).not.toHaveBeenCalled()
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	it('asks for permission with the source of the request', async () => {
		// @spec components/infrastructure/fan/web/global/notification-prompt "Fan denies"
		mockNotificationManager.permission = 'denied'
		const svc = new PushServiceClient()

		await expect(svc.create('notification_prompt')).resolves.toBeNull()

		// NotificationManager reports the answer with this source.
		expect(mockNotificationManager.requestPermission).toHaveBeenCalledWith(
			'notification_prompt',
		)
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	it('granted + no browser sub → auto re-subscribe and register → enabled', async () => {
		pushManager.getSubscription.mockResolvedValue(null)
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('enabled')
		expect(pushManager.subscribe).toHaveBeenCalledWith({
			userVisibleOnly: true,
			applicationServerKey: 'BNg-test-key',
		})
		expect(mockRpc.create).toHaveBeenCalledTimes(1)
		// No permission prompt path beyond the granted-check.
		expect(mockNotificationManager.requestPermission).toHaveBeenCalledTimes(1)
	})

	it('subscribe() throws during auto re-subscribe → error (OFF, surfaced)', async () => {
		pushManager.getSubscription.mockResolvedValue(null)
		pushManager.subscribe.mockRejectedValue(
			new DOMException('denied', 'NotAllowedError'),
		)
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('error')
	})

	it('Create RPC failure during self-heal → error (never a false enabled)', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockRejectedValue(notFound())
		mockRpc.create.mockRejectedValue(new Error('backend down'))
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState(true)).resolves.toBe('error')
	})
})

describe('PushServiceClient.delete', () => {
	// @spec components/infrastructure/fan/web/route/settings "Toggling notifications OFF (this browser only)"
	it('deletes this browser endpoint only, then unsubscribes the browser', async () => {
		const sub = browserSub('https://push/this-browser')
		pushManager.getSubscription.mockResolvedValue(sub)
		const svc = new PushServiceClient()

		await svc.delete()

		// Only this endpoint is named; the backend takes the user from the token.
		expect(mockRpc.delete).toHaveBeenCalledWith('https://push/this-browser')
		expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
	})
})
