import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { Code, ConnectError } from '@connectrpc/connect'
import { CustomElement, Registration } from 'aurelia'
import { UserManager } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDocumentLocation } from '../../src/adapter/browser/document-location'
import { IPasskeyRpcClient } from '../../src/adapter/rpc/client/passkey-client'
import {
	IPasskeyClient,
	type Passkey,
	PasskeyRequestError,
} from '../../src/adapter/zitadel/passkey-client'
import { IAppConfig } from '../../src/config/app-config'
import { StorageKeys } from '../../src/constants/storage-keys'
import { BusyOnClickCustomAttribute } from '../../src/custom-attributes/busy-on-click'
import type { PasskeyRecord } from '../../src/entities/passkey'
import ja from '../../src/locales/ja/translation.json'
import { PasskeysRoute } from '../../src/routes/passkeys/passkeys-route'
import { PasskeysCallbackRoute } from '../../src/routes/passkeys-callback/passkeys-callback-route'
import { IAddPasskeyPromptService } from '../../src/services/add-passkey-prompt-service'
import { IAuthService } from '../../src/services/auth-service'
import {
	IPasskeyAuthService,
	PasskeyAuthService,
} from '../../src/services/passkey-auth-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAppConfig } from '../helpers/mock-app-config'
import { mockPasskeyUserManager } from '../helpers/mock-passkey-user-manager'

vi.mock('oidc-client-ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('oidc-client-ts')>()
	return { ...actual, UserManager: vi.fn() }
})

const FAN_SUB = 'zitadel-user-1'
const nowSec = () => Math.floor(Date.now() / 1000)

/** The signed-in fan of the main session. */
function mainAuth() {
	return {
		isAuthenticated: true,
		ready: Promise.resolve(),
		user: { profile: { sub: FAN_SUB, email: 'fan@example.com' } },
	}
}

const IPHONE: Passkey = { id: 'pk-1', name: 'Apple iPhone, iOS, Mobile Safari' }
const WINDOWS: Passkey = { id: 'pk-2', name: 'Windows, Chrome' }

/**
 * The passkey-management sign-in, end to end on the app's side: the
 * passkeys route, the callback route and the real PasskeyAuthService over a
 * stand-in oidc-client-ts UserManager (the hosted login itself is not here).
 */
describe('Passkey management requires a recent sign-in', () => {
	let manager: ReturnType<typeof mockPasskeyUserManager>
	let container: ReturnType<typeof createTestContainer>

	beforeEach(() => {
		vi.mocked(UserManager).mockReset()
		manager = mockPasskeyUserManager()
		container = createTestContainer(
			Registration.instance(IAuthService, mainAuth()),
			Registration.instance(IPasskeyClient, {
				list: vi.fn(async () => [IPHONE]),
			}),
			Registration.instance(IDocumentLocation, { assign: vi.fn() }),
			Registration.instance(IPasskeyRpcClient, { list: vi.fn(async () => []) }),
		)
		container.register(PasskeyAuthService)
	})

	const passkeysRoute = () => container.invoke(PasskeysRoute)
	const callbackRoute = () => container.invoke(PasskeysCallbackRoute)

	it('opens passkey management straight from a sign-in the hosted login still accepts', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Recent sign-in"
		// Opening the row asks the hosted login for a sign-in no older than 300 s.
		expect(await passkeysRoute().canLoad()).toBe(false)
		expect(manager.signinRedirect).toHaveBeenCalledWith(
			expect.objectContaining({ max_age: 300, login_hint: 'fan@example.com' }),
		)
		expect(manager.signinRedirect.mock.lastCall?.[0]).not.toHaveProperty(
			'prompt',
		)

		// Signed in 2 minutes ago: the hosted login returns without asking.
		manager.signInAs(FAN_SUB, nowSec() - 120)
		expect(await callbackRoute().canLoad()).toBe('/settings/passkeys')
		expect(await passkeysRoute().canLoad()).toBe(true)
		expect(manager.signinRedirect).toHaveBeenCalledTimes(1)
	})

	it('opens passkey management after the hosted login asked for a passkey again', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Older sign-in"
		// Signed in 3 days ago: max_age=300 makes the hosted login ask for a
		// passkey before it returns.
		expect(await passkeysRoute().canLoad()).toBe(false)
		expect(manager.signinRedirect).toHaveBeenCalledWith(
			expect.objectContaining({ max_age: 300 }),
		)

		manager.signInAs(FAN_SUB, nowSec())
		expect(await callbackRoute().canLoad()).toBe('/settings/passkeys')
		expect(await passkeysRoute().canLoad()).toBe(true)
	})

	it('asks the hosted login again when the fan reopens it after leaving', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Re-opening after leaving"
		manager.signInAs(FAN_SUB, nowSec())
		await callbackRoute().canLoad()
		const open = passkeysRoute()
		expect(await open.canLoad()).toBe(true)

		// Leaving discards the token.
		open.unloading()
		expect(container.get(IPasskeyAuthService).session).toBeNull()

		// Reopening needs the 5-minute rule again.
		expect(await passkeysRoute().canLoad()).toBe(false)
		expect(manager.signinRedirect).toHaveBeenCalledTimes(1)
		expect(manager.signinRedirect).toHaveBeenLastCalledWith(
			expect.objectContaining({ max_age: 300 }),
		)
	})

	it('refuses a sign-in that returned another account', async () => {
		manager.signInAs('someone-else', nowSec())
		const callback = callbackRoute()
		expect(await callback.canLoad()).toBe(true)
		expect(callback.failure).toBe('otherAccount')
		expect(container.get(IPasskeyAuthService).session).toBeNull()
	})

	it('shows a failure when the hosted login sign-in did not complete', async () => {
		manager.signinCallback.mockRejectedValueOnce(new Error('access_denied'))
		const callback = callbackRoute()
		expect(await callback.canLoad()).toBe(true)
		expect(callback.failure).toBe('failed')
	})

	it('sends a guest back to Settings', async () => {
		const child = container.createChild()
		child.register(
			Registration.instance(IAuthService, {
				...mainAuth(),
				isAuthenticated: false,
			}),
		)
		expect(await child.invoke(PasskeysRoute).canLoad()).toBe('/settings')
		expect(manager.signinRedirect).not.toHaveBeenCalled()
	})
})

const BottomSheetStub = CustomElement.define(
	{
		name: 'bottom-sheet',
		template: '<div if.bind="open"><au-slot></au-slot></div>',
		bindables: ['open', 'ariaLabel'],
	},
	class {},
)

async function renderManagement(
	passkeys: Passkey[],
	listRecords: () => Promise<PasskeyRecord[]> = async () => [],
) {
	const records = { list: vi.fn(listRecords) }
	let stored = [...passkeys]
	const client = {
		list: vi.fn(async () => [...stored]),
		remove: vi.fn(async (id: string) => {
			stored = stored.filter((p) => p.id !== id)
		}),
	}
	const location = { assign: vi.fn() }
	const passkeyAuth = {
		session: { userId: FAN_SUB, accessToken: 'passkey-token' },
		discard: vi.fn(),
		start: vi.fn(async () => {}),
	}
	const fixture = await createFixture
		.html('<passkeys-route></passkeys-route>')
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			Registration.instance(IAuthService, mainAuth()),
			Registration.instance(IPasskeyAuthService, passkeyAuth),
			Registration.instance(IPasskeyClient, client),
			Registration.instance(IPasskeyRpcClient, records),
			Registration.instance(IDocumentLocation, location),
			Registration.instance(IAppConfig, createMockAppConfig()),
			BottomSheetStub,
			BusyOnClickCustomAttribute,
			PasskeysRoute,
		)
		.build().started
	const host = fixture.appHost
	const vm = CustomElement.for<PasskeysRoute>(
		host.querySelector('passkeys-route') as HTMLElement,
	).viewModel

	async function settle(): Promise<void> {
		await new Promise((r) => setTimeout(r, 0))
		await tasksSettled()
	}
	// The router calls `loading` when the route opens.
	vm.loading()
	await settle()

	const names = () =>
		[...host.querySelectorAll('[data-testid="passkeys-name"]')].map((n) =>
			n.textContent?.trim(),
		)
	const removeButtons = () => [
		...host.querySelectorAll<HTMLButtonElement>(
			'[data-testid="passkeys-remove"]',
		),
	]
	const q = <T extends Element>(testId: string) =>
		host.querySelector<T>(`[data-testid="${testId}"]`)
	const added = () =>
		[...host.querySelectorAll('[data-testid="passkeys-item"]')].map(
			(item) =>
				item.querySelector('time')?.getAttribute('datetime') ?? undefined,
		)

	return {
		added,
		records,
		vm,
		container: fixture.container,
		client,
		location,
		names,
		removeButtons,
		q,
		settle,
		setStored: (next: Passkey[]) => {
			stored = next
		},
	}
}

describe('Passkey management lists, adds and removes passkeys (fixture)', () => {
	it('lists both passkeys with their names, each offering removal', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Two passkeys"
		const { names, removeButtons } = await renderManagement([IPHONE, WINDOWS])
		expect(names()).toEqual([
			'Apple iPhone, iOS, Mobile Safari',
			'Windows, Chrome',
		])
		expect(removeButtons().map((b) => b.disabled)).toEqual([false, false])
	})

	it('shows a recorded passkey by its provider name with the date it was added', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Recorded passkey"
		const pixel: Passkey = {
			id: 'pk-9',
			name: 'Google Pixel 9, Android, Chrome',
		}
		const { names, added, q } = await renderManagement([pixel], async () => [
			{
				id: 'pk-9',
				providerName: 'Google Password Manager',
				// 2026-10-20 10:00 JST
				createTime: new Date('2026-10-20T01:00:00Z'),
			},
		])
		expect(names()).toEqual(['Google Password Manager'])
		expect(added()).toEqual(['2026-10-20'])
		expect(q('passkeys-added')?.textContent).toContain('2026')
	})

	it('shows a passkey without a record by its name and no date', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Passkey without a record"
		const { names, added } = await renderManagement(
			[IPHONE, WINDOWS],
			async () => [
				{
					id: 'pk-1',
					providerName: 'iCloud Keychain',
					createTime: new Date('2026-10-01T00:00:00Z'),
				},
			],
		)
		expect(names()).toEqual(['iCloud Keychain', 'Windows, Chrome'])
		expect(added()).toEqual(['2026-10-01', undefined])
	})

	it('still lists the passkeys by name when the records cannot be read', async () => {
		const { names, added, q } = await renderManagement(
			[IPHONE, WINDOWS],
			async () => {
				throw new ConnectError('down', Code.Unavailable)
			},
		)
		expect(q('passkeys-list-error')).toBeNull()
		expect(names()).toEqual([
			'Apple iPhone, iOS, Mobile Safari',
			'Windows, Chrome',
		])
		expect(added()).toEqual([undefined, undefined])
	})

	it('names a passkey without a name "Passkey"', async () => {
		const { names } = await renderManagement([{ id: 'pk-3', name: '' }, IPHONE])
		expect(names()[0]).toBe(ja.passkeys.unnamed)
	})

	it('adds a passkey on this device in the hosted login and lists one more on return', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Add a passkey on this device"
		const first = await renderManagement([IPHONE])
		first.q<HTMLButtonElement>('passkeys-add')?.click()

		// Off to the hosted login's passkey creation for this fan and org.
		expect(first.location.assign).toHaveBeenCalledWith(
			'https://auth.test.local/ui/v2/login/passkey/set?loginName=fan%40example.com&organization=test-org-id',
		)
		// The root route reads the marker on the way back (design D4) and
		// records the device for the add-passkey prompt (D10).
		expect(
			first.container.get(IAddPasskeyPromptService).takeReturnAfterCreate(),
		).toBe('/settings/passkeys')
		expect(localStorage.getItem(StorageKeys.passkeyDeviceRecord)).toBe('1')
		localStorage.removeItem(StorageKeys.passkeyDeviceRecord)

		// Back in passkey management, the new passkey is listed.
		const back = await renderManagement([IPHONE, WINDOWS])
		expect(back.names()).toHaveLength(first.names().length + 1)
	})

	it('removes a passkey after a confirmation that mentions the passkey manager', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Remove a passkey"
		const { client, names, removeButtons, q, settle } = await renderManagement([
			IPHONE,
			WINDOWS,
		])
		removeButtons()[1]?.click()
		await settle()

		const confirm = q('passkeys-confirm')
		expect(confirm?.textContent).toContain('Windows, Chrome')
		expect(confirm?.textContent).toContain(ja.passkeys.confirm.managerNote)
		expect(client.remove).not.toHaveBeenCalled()

		q<HTMLButtonElement>('passkeys-confirm-remove')?.click()
		await settle()

		// Removed at the identity provider, so it no longer signs in.
		expect(client.remove).toHaveBeenCalledWith('pk-2')
		expect(names()).toEqual(['Apple iPhone, iOS, Mobile Safari'])
		expect(q('passkeys-confirm')).toBeNull()
	})

	it('disables removal of the last passkey and explains why', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Last passkey"
		const { removeButtons, q, vm, client } = await renderManagement([IPHONE])
		expect(removeButtons().map((b) => b.disabled)).toEqual([true])
		expect(q('passkeys-last-note')?.textContent).toBe(ja.passkeys.lastPasskey)

		// Not even a programmatic call removes it.
		vm.askRemoval(IPHONE)
		await vm.confirmRemoval()
		expect(client.remove).not.toHaveBeenCalled()
	})

	it('says a failed removal failed, offers to try again and keeps the passkey listed', async () => {
		// @spec components/infrastructure/fan/web/route/settings "Removal fails"
		const { client, names, removeButtons, q, settle } = await renderManagement([
			IPHONE,
			WINDOWS,
		])
		client.remove.mockRejectedValueOnce(
			new PasskeyRequestError('failed', 'HTTP 503'),
		)
		removeButtons()[1]?.click()
		await settle()
		q<HTMLButtonElement>('passkeys-confirm-remove')?.click()
		await settle()

		expect(q('passkeys-removal-error')?.textContent).toBe(
			ja.passkeys.confirm.failed,
		)
		expect(q('passkeys-confirm-remove')?.textContent?.trim()).toBe(
			ja.passkeys.retry,
		)
		expect(names()).toEqual([
			'Apple iPhone, iOS, Mobile Safari',
			'Windows, Chrome',
		])

		// Trying again succeeds.
		q<HTMLButtonElement>('passkeys-confirm-remove')?.click()
		await settle()
		expect(client.remove).toHaveBeenCalledTimes(2)
		expect(names()).toEqual(['Apple iPhone, iOS, Mobile Safari'])
	})

	it('says the list could not be read and offers to try again', async () => {
		const { client, vm, q, settle, names } = await renderManagement([IPHONE])
		client.list.mockRejectedValueOnce(
			new PasskeyRequestError('failed', 'network'),
		)
		await vm.load()
		await settle()
		expect(q('passkeys-list-error')?.textContent).toContain(
			ja.passkeys.listFailed,
		)
		await vm.load()
		await settle()
		expect(names()).toEqual(['Apple iPhone, iOS, Mobile Safari'])
	})
})
