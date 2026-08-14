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
// organizer entry would pass to Zitadel rather than performing real network I/O.
vi.mock('oidc-client-ts')

/**
 * The organizer console reuses the SAME shared AuthService as the consumer and
 * admin entries (design D1), but — unlike them — its `/config.json` carries NO
 * fixed org id. `organizer/main.ts` pins the tenant per session by folding a
 * resolved org handle into `config.zitadelOrgId` before AuthService reads it.
 * These tests pin that org-pinned-entry contract at the OIDC-settings seam:
 *   - a resolved handle → `urn:zitadel:iam:org:id:<id>` scope (org pinned);
 *   - no handle (undefined org id) → no org scope (unpinned sign-in).
 */
describe('AuthService org-pinned sign-in (organizer)', () => {
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

	function buildWith(orgId: string | undefined): IAuthService {
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

	it('pins the resolved org handle into the OIDC scope', () => {
		buildWith('tenant-org-999')

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:id:tenant-org-999',
		)
		expect(lastSettings.scope).toContain('openid profile email offline_access')
	})

	it('omits the org scope entirely when no org id is resolved (unpinned)', () => {
		buildWith(undefined)

		expect(lastSettings.scope).not.toContain('urn:zitadel:iam:org:id:')
		// The base OIDC scopes are still present.
		expect(lastSettings.scope).toContain('openid profile email offline_access')
	})
})
