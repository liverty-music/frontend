import { ErrorResponse, InMemoryWebStorage, UserManager } from 'oidc-client-ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	FreshSignInError,
	FreshSignInService,
	IFreshSignInService,
} from '../../src/services/fresh-sign-in-service'
import { createTestContainer } from '../helpers/create-container'
import { mockFreshSignInUserManager } from '../helpers/mock-fresh-sign-in-user-manager'

vi.mock('oidc-client-ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('oidc-client-ts')>()
	return { ...actual, UserManager: vi.fn() }
})

describe('FreshSignInService', () => {
	let manager: ReturnType<typeof mockFreshSignInUserManager>
	let sut: FreshSignInService

	beforeEach(() => {
		vi.mocked(UserManager).mockReset()
		manager = mockFreshSignInUserManager()
		const container = createTestContainer()
		container.register(FreshSignInService)
		sut = container.get(IFreshSignInService)
	})

	afterEach(() => {
		sessionStorage.clear()
	})

	it('asks for the identity provider API audience with a 5-minute max_age, kept in memory', () => {
		const settings = vi.mocked(UserManager).mock.lastCall?.[0]
		expect(settings?.scope?.split(' ')).toEqual([
			'openid',
			'urn:zitadel:iam:org:project:id:zitadel:aud',
			'urn:zitadel:iam:org:id:test-org-id',
		])
		expect(settings?.max_age).toBe(300)
		// One redirect URI for every screen (design D4).
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

	it('starts the sign-in with max_age=300, the fan as login hint and the screen in the request state', async () => {
		await sut.start('passkeys', {
			loginHint: 'fan@example.com',
			uiLocales: 'ja',
		})
		expect(manager.signinRedirect).toHaveBeenCalledWith({
			max_age: 300,
			state: { returnTo: 'passkeys' },
			login_hint: 'fan@example.com',
			ui_locales: 'ja',
		})
	})

	it('returns to passkey management with its tokens, and none after discard', async () => {
		expect(sut.sessionFor('passkeys')).toBeNull()
		await sut.start('passkeys')
		manager.signInAs('zitadel-user-1')

		const session = await sut.handleCallback()
		expect(session).toEqual({
			userId: 'zitadel-user-1',
			accessToken: 'passkey-token',
			idToken: 'fresh-id-token',
			returnTo: 'passkeys',
		})
		expect(sut.sessionFor('passkeys')).toEqual(session)
		// The session serves only the screen it was started for.
		expect(sut.sessionFor('deleteAccount')).toBeNull()

		sut.discard()
		expect(sut.sessionFor('passkeys')).toBeNull()
		expect(manager.removeUser).toHaveBeenCalled()
	})

	it('returns to the withdrawal screen with the ID token of the sign-in', async () => {
		await sut.start('deleteAccount')
		expect(manager.signinRedirect).toHaveBeenCalledWith(
			expect.objectContaining({ state: { returnTo: 'deleteAccount' } }),
		)
		manager.signInAs('zitadel-user-1')

		const session = await sut.handleCallback()
		expect(session.returnTo).toBe('deleteAccount')
		expect(session.idToken).toBe('fresh-id-token')
		expect(sut.sessionFor('deleteAccount')).toEqual(session)
		expect(sut.sessionFor('passkeys')).toBeNull()
	})

	it('treats a sign-in without a screen in its state as passkey management', async () => {
		// A sign-in started by the app before the withdrawal screen existed.
		manager.signInAs('zitadel-user-1')
		const session = await sut.handleCallback()
		expect(session.returnTo).toBe('passkeys')
	})

	it('names the screen when the hosted login returns an error', async () => {
		const error = new ErrorResponse({
			error: 'access_denied',
			userState: { returnTo: 'deleteAccount' },
		})
		manager.signinCallback.mockRejectedValueOnce(error)

		const failure = await sut.handleCallback().catch((e: unknown) => e)
		expect(failure).toBeInstanceOf(FreshSignInError)
		expect((failure as FreshSignInError).returnTo).toBe('deleteAccount')
		expect(sut.sessionFor('deleteAccount')).toBeNull()
	})

	it('tells the screen once that a sign-in it started came back', async () => {
		expect(sut.takeReturn('deleteAccount')).toBe(false)
		await sut.start('deleteAccount')
		expect(sut.takeReturn('passkeys')).toBe(false)
		await sut.start('deleteAccount')
		expect(sut.takeReturn('deleteAccount')).toBe(true)
		expect(sut.takeReturn('deleteAccount')).toBe(false)
	})
})
