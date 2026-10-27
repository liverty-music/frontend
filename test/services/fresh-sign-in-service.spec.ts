import { InMemoryWebStorage, UserManager } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	IPasskeyAuthService,
	PasskeyAuthService,
} from '../../src/services/passkey-auth-service'
import { createTestContainer } from '../helpers/create-container'
import { mockPasskeyUserManager } from '../helpers/mock-passkey-user-manager'

vi.mock('oidc-client-ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('oidc-client-ts')>()
	return { ...actual, UserManager: vi.fn() }
})

describe('PasskeyAuthService', () => {
	let manager: ReturnType<typeof mockPasskeyUserManager>
	let sut: PasskeyAuthService

	beforeEach(() => {
		vi.mocked(UserManager).mockReset()
		manager = mockPasskeyUserManager()
		const container = createTestContainer()
		container.register(PasskeyAuthService)
		sut = container.get(IPasskeyAuthService)
	})

	it('asks for the identity provider API audience with a 5-minute max_age, kept in memory', () => {
		const settings = vi.mocked(UserManager).mock.lastCall?.[0]
		expect(settings?.scope?.split(' ')).toEqual([
			'openid',
			'urn:zitadel:iam:org:project:id:zitadel:aud',
			'urn:zitadel:iam:org:id:test-org-id',
		])
		expect(settings?.max_age).toBe(300)
		expect(settings?.redirect_uri).toBe(
			`${window.location.origin}/auth/passkeys-callback`,
		)
		// No refresh token: the token is never renewed.
		expect(settings?.scope).not.toContain('offline_access')
		expect(settings?.automaticSilentRenew).toBe(false)
		// The token lives in memory only.
		const userStore = settings?.userStore as unknown as { _store: unknown }
		expect(userStore._store).toBeInstanceOf(InMemoryWebStorage)
	})

	it('has no session until the callback completes, and none after discard', async () => {
		expect(sut.session).toBeNull()
		manager.signInAs('zitadel-user-1')
		const session = await sut.handleCallback()
		expect(session).toEqual({
			userId: 'zitadel-user-1',
			accessToken: 'passkey-token',
		})
		expect(sut.session).toEqual(session)

		sut.discard()
		expect(sut.session).toBeNull()
		expect(manager.removeUser).toHaveBeenCalled()
	})

	it('starts the sign-in with max_age=300 and the fan as login hint', async () => {
		await sut.start({ loginHint: 'fan@example.com', uiLocales: 'ja' })
		expect(manager.signinRedirect).toHaveBeenCalledWith({
			max_age: 300,
			login_hint: 'fan@example.com',
			ui_locales: 'ja',
		})
	})
})
