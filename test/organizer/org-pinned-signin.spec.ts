import { DI, IEventAggregator, ILogger, Registration } from 'aurelia'
import {
	UserManager,
	type UserManagerSettings,
	type UserManager as UserManagerType,
} from 'oidc-client-ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	applyOrgPin,
	ORG_SHORT_NAME_STORAGE_KEY,
	resolveOrgPin,
} from '../../organizer/services/org-handle'
import { type AppConfig, IAppConfig } from '../../shared/config/app-config'
import { AuthService, IAuthService } from '../../shared/services/auth-service'
import { createMockAppConfig } from '../helpers/mock-app-config'
import { createMockLocalStorage } from '../helpers/mock-local-storage'
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
 *   - `?org_id=<id>` → `urn:zitadel:iam:org:id:<id>` scope;
 *   - `?org=<short name>` → `urn:zitadel:iam:org:domain:primary:<short
 *     name>.<identity provider host>` scope (design D4);
 *   - no pin → no org scope (the route guard then never signs in).
 */
describe('AuthService org-pinned sign-in (organizer)', () => {
	let lastSettings: UserManagerSettings

	beforeEach(() => {
		// Vitest 4 invokes a mocked class's `mockImplementation` via `new`, so it
		// must be a constructable function expression (arrow functions throw
		// "is not a constructor").
		// biome-ignore lint/complexity/useArrowFunction: must stay a constructable function expression for `new`
		vi.mocked(UserManager).mockImplementation(function (
			settings: UserManagerSettings,
		) {
			lastSettings = settings
			return {
				events: { addUserLoaded: vi.fn(), addUserUnloaded: vi.fn() },
				getUser: vi.fn().mockResolvedValue(null),
			} as unknown as UserManagerType
		} as unknown as typeof UserManager)
	})

	function buildWithConfig(config: AppConfig): IAuthService {
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IEventAggregator, { publish: vi.fn() }),
		)
		container.register(Registration.instance(IAppConfig, config))
		container.register(AuthService)
		return container.get(IAuthService)
	}

	function buildWith(orgId: string | undefined): IAuthService {
		return buildWithConfig(createMockAppConfig({ zitadelOrgId: orgId }))
	}

	/** Bootstraps as `organizer/main.ts` does, from an address and a device. */
	function bootWith(
		search: string,
		storage = createMockLocalStorage(),
	): IAuthService {
		const config = createMockAppConfig({
			zitadelIssuer: 'https://auth.liverty-music.app',
			zitadelOrgId: undefined,
		})
		return buildWithConfig(applyOrgPin(config, resolveOrgPin(search, storage)))
	}

	it('pins the resolved org handle into the OIDC scope', () => {
		buildWith('tenant-org-999')

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:id:tenant-org-999',
		)
		expect(lastSettings.scope).toContain('openid profile email offline_access')
	})

	// @spec stories/sign-in-as-organizer "One OIDC client serves all tenants"
	it('uses the same OIDC client for every tenant org', () => {
		buildWith('tenant-org-a')
		const tenantA = lastSettings
		buildWith('tenant-org-b')
		const tenantB = lastSettings

		expect(tenantA.client_id).toBe(createMockAppConfig().zitadelClientId)
		expect(tenantB.client_id).toBe(tenantA.client_id)
		// Only the org scope differs between tenants.
		expect(tenantA.scope).toContain('urn:zitadel:iam:org:id:tenant-org-a')
		expect(tenantB.scope).toContain('urn:zitadel:iam:org:id:tenant-org-b')
	})

	it('omits the org scope entirely when no org id is resolved (unpinned)', () => {
		buildWith(undefined)

		expect(lastSettings.scope).not.toContain('urn:zitadel:iam:org:id:')
		// The base OIDC scopes are still present.
		expect(lastSettings.scope).toContain('openid profile email offline_access')
	})

	// @spec components/infrastructure/organizer/web/global/hosted-login "Owner whose email is also a fan account"
	it("names the Organizer's Organization by primary domain for ?org=<short name>", () => {
		bootWith('?org=xx-records')

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:domain:primary:xx-records.auth.liverty-music.app',
		)
		// One Organization, never the id form as well, never none.
		expect(lastSettings.scope).not.toContain('urn:zitadel:iam:org:id:')
	})

	// @spec components/infrastructure/organizer/web/global/organizer-shell "Remembered Organization"
	it('names the remembered Organization on a device that signed in before', () => {
		bootWith(
			'',
			createMockLocalStorage({ [ORG_SHORT_NAME_STORAGE_KEY]: 'xx-records' }),
		)

		expect(lastSettings.scope).toContain(
			'urn:zitadel:iam:org:domain:primary:xx-records.auth.liverty-music.app',
		)
	})

	it('names no Organization when neither the address nor the device does', () => {
		bootWith('')

		expect(lastSettings.scope).not.toContain('urn:zitadel:iam:org:')
	})
})
