import { DI, IEventAggregator, ILogger, Registration } from 'aurelia'
import {
	UserManager,
	type UserManagerSettings,
	type UserManager as UserManagerType,
} from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IAppConfig } from '../../shared/config/app-config'
import { AuthService, IAuthService } from '../../shared/services/auth-service'
import { createMockAppConfig } from '../helpers/mock-app-config'
import { createMockLogger } from '../helpers/mock-logger'

// Mock oidc-client-ts so constructing AuthService captures the settings the
// admin entry would pass to Zitadel rather than performing real network I/O.
vi.mock('oidc-client-ts')

/**
 * The admin console reuses the SAME shared AuthService as the consumer (design
 * D1). The only thing that scopes sign-in to the admin org is `zitadelOrgId`
 * from the admin pod's `/config.json`. These tests pin the invariant that the
 * OIDC settings carry `urn:zitadel:iam:org:id:<id>` derived from that field, so
 * Zitadel applies the admin org's Google-Workspace login policy.
 */
describe('AuthService org-scoped sign-in', () => {
	let lastSettings: UserManagerSettings

	beforeEach(() => {
		vi.mocked(UserManager).mockImplementation(
			(settings: UserManagerSettings) => {
				lastSettings = settings
				return {
					events: { addUserLoaded: vi.fn(), addUserUnloaded: vi.fn() },
					getUser: vi.fn().mockResolvedValue(null),
				} as unknown as UserManagerType
			},
		)
	})

	function buildWith(orgId: string): IAuthService {
		// A bare container (not createTestContainer) so the per-test config — not
		// the helper's default IAppConfig — is the one AuthService resolves.
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IEventAggregator, { publish: vi.fn() }),
		)
		container.register(
			Registration.instance(
				IAppConfig,
				createMockAppConfig({ zitadelOrgId: orgId }),
			),
		)
		container.register(AuthService)
		return container.get(IAuthService)
	}

	it('includes the admin org id in the OIDC scope', () => {
		buildWith('admin-org-12345')

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:id:admin-org-12345',
		)
		// The base OIDC scopes are still present.
		expect(lastSettings.scope).toContain('openid profile email offline_access')
	})

	it('derives the scope from config.zitadelOrgId (different org → different scope)', () => {
		buildWith('some-other-org')

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:id:some-other-org',
		)
		expect(lastSettings.scope).not.toContain(
			'urn:zitadel:iam:org:id:admin-org-12345',
		)
	})

	it('targets the configured Zitadel authority and client id', () => {
		buildWith('admin-org-12345')

		expect(lastSettings.authority).toBe('https://auth.test.local')
		expect(lastSettings.client_id).toBe('test-client-id')
	})
})
