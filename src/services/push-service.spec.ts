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
				case 'IPushRpcClient':
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

vi.mock('../adapter/rpc/client/push-client', () => ({
	IPushRpcClient: { friendlyName: 'IPushRpcClient' },
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
	it('permission not granted → needs-permission, no RPC calls', async () => {
		mockNotificationManager.permission = 'default'
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState('user-1')).resolves.toBe(
			'needs-permission',
		)
		expect(mockRpc.get).not.toHaveBeenCalled()
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	it('granted + browser sub already registered on backend → enabled, no re-register', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockResolvedValue({ subscription: {} })
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState('user-1')).resolves.toBe('enabled')
		expect(mockRpc.create).not.toHaveBeenCalled()
	})

	it('granted + browser sub missing on backend → self-heal via Create → enabled', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockRejectedValue(notFound())
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState('user-1')).resolves.toBe('enabled')
		expect(mockRpc.create).toHaveBeenCalledTimes(1)
	})

	it('granted + no browser sub → auto re-subscribe and register → enabled', async () => {
		pushManager.getSubscription.mockResolvedValue(null)
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState('user-1')).resolves.toBe('enabled')
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

		await expect(svc.resolvePushState('user-1')).resolves.toBe('error')
	})

	it('Create RPC failure during self-heal → error (never a false enabled)', async () => {
		pushManager.getSubscription.mockResolvedValue(browserSub('https://push/x'))
		mockRpc.get.mockRejectedValue(notFound())
		mockRpc.create.mockRejectedValue(new Error('backend down'))
		const svc = new PushServiceClient()

		await expect(svc.resolvePushState('user-1')).resolves.toBe('error')
	})
})
