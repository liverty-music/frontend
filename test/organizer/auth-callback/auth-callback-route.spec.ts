import { DI, ILogger, Registration } from 'aurelia'
import type { User } from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IAppConfig } from '../../../shared/config/app-config'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'
import { createMockLogger } from '../../helpers/mock-logger'

// Mock IAuthService so the route binds to a test double rather than
// constructing a real UserManager (oidc-client-ts).
const mockIAuthService = DI.createInterface('IAuthService')

vi.mock('../../../shared/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

const { AuthCallbackRoute, CALLBACK_RETRY_FLAG, ORG_MISMATCH_FLAG } =
	await import('../../../organizer/auth-callback/auth-callback-route')

const STATE_MISS = new Error('No matching state found in storage')
const ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'
// createMockAppConfig defaults zitadelOrgId to 'test-org-id'.
const TENANT_ORG = 'test-org-id'

/** A token whose owner-role claim grants the given tenant org. */
function userInOrg(orgId: string): User {
	return {
		profile: { [ROLES_CLAIM]: { owner: { [orgId]: 'tenant.example' } } },
	} as unknown as User
}

describe('Organizer AuthCallbackRoute', () => {
	let sut: InstanceType<typeof AuthCallbackRoute>
	let mockAuth: ReturnType<typeof createMockAuth>

	function build(
		authOverrides: Parameters<typeof createMockAuth>[0],
		opts: { zitadelOrgId?: string } = {},
	) {
		mockAuth = createMockAuth(authOverrides)
		// Build the container directly (not via createTestContainer) so the test
		// controls IAppConfig.zitadelOrgId — the intended-tenant signal the
		// callback enforces. Default it to the matching TENANT_ORG.
		const zitadelOrgId = 'zitadelOrgId' in opts ? opts.zitadelOrgId : TENANT_ORG
		const container = DI.createContainer()
		container.register(
			Registration.instance(ILogger, createMockLogger()),
			Registration.instance(IAppConfig, createMockAppConfig({ zitadelOrgId })),
			Registration.instance(mockIAuthService, mockAuth),
		)
		container.register(AuthCallbackRoute)
		sut = container.get(AuthCallbackRoute)
	}

	beforeEach(() => {
		window.sessionStorage.clear()
		build({})
	})

	it('routes to welcome when the authenticated org matches the intended tenant', async () => {
		build({})
		mockAuth.handleCallback = vi.fn().mockResolvedValue(userInOrg(TENANT_ORG))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/welcome')
		expect(mockAuth.handleCallback).toHaveBeenCalledTimes(1)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('clears a stale retry flag on a matching successful callback', async () => {
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({})
		mockAuth.handleCallback = vi.fn().mockResolvedValue(userInOrg(TENANT_ORG))

		await sut.canLoad({} as never, {} as never)

		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBeNull()
	})

	it('forces re-auth once when the session resolves to a different org', async () => {
		build({})
		mockAuth.handleCallback = vi
			.fn()
			.mockResolvedValue(userInOrg('some-other-org'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
		expect(mockAuth.signIn).toHaveBeenCalledWith({ forceLogin: true })
		expect(window.sessionStorage.getItem(ORG_MISMATCH_FLAG)).toBe('1')
	})

	it('fails closed (error, no second re-auth) if still the wrong org after retry', async () => {
		window.sessionStorage.setItem(ORG_MISMATCH_FLAG, '1')
		build({})
		mockAuth.handleCallback = vi
			.fn()
			.mockResolvedValue(userInOrg('some-other-org'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.error).toContain('wrong organization')
	})

	it('skips org enforcement when no intended org is pinned', async () => {
		build({}, { zitadelOrgId: undefined })
		mockAuth.handleCallback = vi
			.fn()
			.mockResolvedValue(userInOrg('any-org-at-all'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/welcome')
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('self-heals a cross-context state miss by restarting sign-in once', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		// Aborts the in-app nav (the browser redirects to Zitadel) and restarts
		// sign-in exactly once, marking the one-shot flag.
		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
		expect(window.sessionStorage.getItem(CALLBACK_RETRY_FLAG)).toBe('1')
	})

	it('does not restart sign-in a second time; shows the error instead', async () => {
		// Simulate that a prior callback already consumed the one-shot retry.
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.error).toContain('No matching state found in storage')
	})

	it('does not restart sign-in for a non-recoverable callback error', async () => {
		build({ isAuthenticated: false })
		mockAuth.handleCallback = vi
			.fn()
			.mockRejectedValue(new Error('token endpoint 500'))

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
		expect(sut.error).toContain('token endpoint 500')
	})

	it('recovers to welcome when a prior callback already established a matching session', async () => {
		build({ isAuthenticated: true, user: userInOrg(TENANT_ORG) })
		mockAuth.handleCallback = vi.fn().mockRejectedValue(STATE_MISS)

		const result = await sut.canLoad({} as never, {} as never)

		expect(result).toBe('/welcome')
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})
})
