import type { RouteNode } from '@aurelia/router'
import { DI, ILogger, Registration } from 'aurelia'
import type { User } from 'oidc-client-ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../shared/config/app-config'
import { IAppConfig } from '../../../shared/config/app-config'
import { createTestContainer } from '../../helpers/create-container'
import { createMockAppConfig } from '../../helpers/mock-app-config'
import { createMockAuth } from '../../helpers/mock-auth'
import { createMockLogger } from '../../helpers/mock-logger'

// Mock IAuthService and ILoginHint so the guard binds to test doubles rather
// than constructing a real UserManager (oidc-client-ts) or reading window.location.
const mockIAuthService = DI.createInterface('IAuthService')
const mockILoginHint = DI.createInterface<string | null>('ILoginHint')

vi.mock('../../../shared/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../../organizer/services/login-hint', () => ({
	ILoginHint: mockILoginHint,
}))

const { OrganizerAuthHook } = await import('../../../organizer/hooks/auth-hook')
const { IConsoleLanguage } = await import(
	'../../../organizer/i18n/console-language'
)
const { savePendingReturn } = await import(
	'../../../organizer/adapter/storage/pending-return-storage'
)
const {
	IOrgPin,
	ORG_ID_STORAGE_KEY,
	ORG_SHORT_NAME_STORAGE_KEY,
	PENDING_ORG_PIN_STORAGE_KEY,
	resolveOrgPin,
} = await import('../../../organizer/services/org-handle')
type OrgPin = import('../../../organizer/services/org-handle').OrgPin

const ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles'

function makeRouteNode(data?: Record<string, unknown>): RouteNode {
	return { data } as unknown as RouteNode
}

function userWithRoles(roles: Record<string, unknown>): User {
	return { profile: { [ROLES_CLAIM]: roles } } as unknown as User
}

// createMockAppConfig (via createTestContainer) defaults zitadelOrgId to
// 'test-org-id' — the intended Organization the guard enforces.
const INTENDED_ORG = 'test-org-id'

/** A token holding the owner role in a specific Organization. */
function userOwnerInOrg(orgId: string): User {
	return userWithRoles({ owner: { [orgId]: 'organization.example' } })
}

describe('OrganizerAuthHook', () => {
	let sut: InstanceType<typeof OrganizerAuthHook>
	let mockAuth: ReturnType<typeof createMockAuth>
	/** The language the console shows; `ja` unless a test switches it. */
	let language: { current: 'ja' | 'en' }

	function build(
		authOverrides: Parameters<typeof createMockAuth>[0],
		loginHint: string | null = null,
	) {
		mockAuth = createMockAuth(authOverrides)
		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockILoginHint, loginHint),
			Registration.instance(IConsoleLanguage, language),
		)
		container.register(OrganizerAuthHook)
		sut = container.get(OrganizerAuthHook)
	}

	beforeEach(() => {
		window.sessionStorage.clear()
		language = { current: 'ja' }
		build({ isAuthenticated: true, user: userWithRoles({ owner: {} }) })
	})

	it('allows the unguarded callback route (auth: false) without checking auth', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({ auth: false })

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('redirects an unauthenticated visitor into the sign-in flow and aborts the nav', async () => {
		build({ isAuthenticated: false })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
	})

	it('passes loginHint to signIn when an invitation link is followed', async () => {
		build({ isAuthenticated: false }, 'member@example.com')
		const next = makeRouteNode({})

		await sut.canLoad({} as never, {}, next, null)

		expect(mockAuth.signIn).toHaveBeenCalledWith({
			loginHint: 'member@example.com',
			returnTo: `${window.location.pathname}${window.location.search}`,
			uiLocales: 'ja',
		})
	})

	// @spec components/infrastructure/organizer/web/global/i18n "Member who chose Japanese on an English browser"
	it('asks the hosted login for the language the console shows', async () => {
		// The console shows Japanese, whatever the browser prefers: the device's
		// saved choice decided it.
		language.current = 'ja'
		build({ isAuthenticated: false })

		await sut.canLoad({} as never, {}, makeRouteNode({}), null)

		expect(mockAuth.signIn).toHaveBeenCalledWith(
			expect.objectContaining({ uiLocales: 'ja' }),
		)
	})

	it('asks the hosted login for English when the console shows English', async () => {
		language.current = 'en'
		build({ isAuthenticated: false })

		await sut.canLoad({} as never, {}, makeRouteNode({}), null)

		expect(mockAuth.signIn).toHaveBeenCalledWith(
			expect.objectContaining({ uiLocales: 'en' }),
		)
	})

	it('returns the member to the address they opened after sign-in', async () => {
		window.history.replaceState(
			null,
			'',
			'/organizers/org-1/artists/a-1/series/s-tour?tab=1',
		)
		build({ isAuthenticated: false }, null)
		const next = makeRouteNode({})

		await sut.canLoad({} as never, {}, next, null)

		expect(mockAuth.signIn).toHaveBeenCalledWith({
			returnTo: '/organizers/org-1/artists/a-1/series/s-tour?tab=1',
			uiLocales: 'ja',
		})
		window.history.replaceState(null, '', '/')
	})

	it('admits an authenticated member holding the owner role', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ owner: {} }) })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	// @spec stories/sign-in-as-organizer "Member signs in and is routed to their Organization by org-pinned entry"
	it('admits when the authenticated session belongs to the intended org', async () => {
		build({ isAuthenticated: true, user: userOwnerInOrg(INTENDED_ORG) })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	// @spec stories/sign-in-as-organizer "Member signs in and is routed to their Organization by org-pinned entry"
	// @spec stories/sign-in-as-organizer "A reused or mismatched session does not silently onboard the wrong member"
	// @spec components/infrastructure/organizer/web/global/hosted-login "Organization is resolved by org-pinned entry for every member"
	it('forces re-auth once when the session belongs to a DIFFERENT org', async () => {
		// Reproduces the org-test-40 → org-test-21 mix: a pre-existing session for
		// another org is admitted without a fresh OIDC exchange; the guard must
		// re-authenticate in the intended Organization instead of admitting it.
		build({ isAuthenticated: true, user: userOwnerInOrg('some-other-org') })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(false)
		expect(mockAuth.signIn).toHaveBeenCalledWith({
			forceLogin: true,
			uiLocales: 'ja',
		})
		expect(window.sessionStorage.getItem('organizer.orgMismatchRetry')).toBe(
			'1',
		)
	})

	// @spec stories/sign-in-as-organizer "A hint for another org grants nothing"
	// @spec components/infrastructure/organizer/web/global/hosted-login "Organization is resolved by org-pinned entry for every member"
	it('denies (no second re-auth) if still the wrong org after a retry', async () => {
		window.sessionStorage.setItem('organizer.orgMismatchRetry', '1')
		build({ isAuthenticated: true, user: userOwnerInOrg('some-other-org') })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe('/denied')
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('routes an authenticated non-owner to the denied placeholder', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ editor: {} }) })
		const next = makeRouteNode({})

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe('/denied')
	})

	it('admits the denied placeholder itself (role: false) for a signed-in non-owner', async () => {
		build({ isAuthenticated: true, user: userWithRoles({ editor: {} }) })
		const next = makeRouteNode({ role: false })

		const result = await sut.canLoad({} as never, {}, next, null)

		expect(result).toBe(true)
	})

	it('awaits authService.ready before evaluating the session', async () => {
		let resolveReady: () => void = () => {}
		const readyPromise = new Promise<void>((r) => {
			resolveReady = r
		})
		build({
			isAuthenticated: true,
			user: userWithRoles({ owner: {} }),
			ready: readyPromise,
		})

		const next = makeRouteNode({})
		const canLoadPromise = sut.canLoad({} as never, {}, next, null)

		let settled = false
		void canLoadPromise.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		resolveReady()
		const result = await canLoadPromise
		expect(result).toBe(true)
	})

	describe('the Organization a sign-in names (design D4)', () => {
		const PRIMARY_DOMAIN = 'xx-records.auth.liverty-music.app'

		/** Builds the guard over a config pinned as `organizer/main.ts` would. */
		function buildPinned(
			pin: Pick<AppConfig, 'zitadelOrgId' | 'zitadelOrgPrimaryDomain'>,
			authOverrides: Parameters<typeof createMockAuth>[0],
			orgPin: OrgPin | null = null,
		) {
			mockAuth = createMockAuth(authOverrides)
			const container = DI.createContainer()
			container.register(
				Registration.instance(ILogger, createMockLogger()),
				Registration.instance(
					IAppConfig,
					createMockAppConfig({ zitadelOrgId: undefined, ...pin }),
				),
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(mockILoginHint, null),
				Registration.instance(IConsoleLanguage, language),
				Registration.instance(IOrgPin, orgPin),
				OrganizerAuthHook,
			)
			sut = container.get(OrganizerAuthHook)
		}

		beforeEach(() => {
			localStorage.clear()
		})

		afterEach(() => {
			window.history.replaceState(null, '', '/')
		})

		// @spec components/infrastructure/organizer/web/global/organizer-shell "New device"
		// @spec components/infrastructure/organizer/web/global/hosted-login "Device that remembers no Organization"
		it('opens find-organizer and starts no sign-in when no Organization is known', async () => {
			buildPinned({}, { isAuthenticated: false })

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe('/find-organizer')
			expect(mockAuth.signIn).not.toHaveBeenCalled()
		})

		// @spec components/infrastructure/organizer/web/global/organizer-shell "Return after a link sign-in"
		it('returns the visitor to the address they opened once they sign in through a link', async () => {
			// A new device opens a deep address: find-organizer, address kept.
			window.history.replaceState(null, '', '/organizers/o-1/settings')
			buildPinned({}, { isAuthenticated: false })
			await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			// The emailed link opens /?org=xx-records (pinned by main.ts).
			window.history.replaceState(null, '', '/?org=xx-records')
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{ isAuthenticated: false },
			)
			await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(mockAuth.signIn).toHaveBeenCalledWith({
				returnTo: '/organizers/o-1/settings',
				uiLocales: 'ja',
			})
		})

		it('ignores an expired remembered address', async () => {
			savePendingReturn('/organizers/o-1/settings', Date.now() - 2 * 86_400_000)
			window.history.replaceState(null, '', '/?org=xx-records')
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{ isAuthenticated: false },
			)

			await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(mockAuth.signIn).toHaveBeenCalledWith({
				returnTo: '/?org=xx-records',
				uiLocales: 'ja',
			})
		})

		// @spec components/infrastructure/organizer/web/global/organizer-shell "Remembered Organization"
		it('starts the sign-in when the device remembers the Organization', async () => {
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{ isAuthenticated: false },
			)

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(false)
			expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
		})

		// @spec components/infrastructure/organizer/web/global/hosted-login "Owner whose email is also a fan account"
		it('admits the session of the Organization named by short name', async () => {
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{
					isAuthenticated: true,
					user: userWithRoles({ owner: { '394': PRIMARY_DOMAIN } }),
				},
			)

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(true)
			expect(mockAuth.signIn).not.toHaveBeenCalled()
		})

		// liverty-music/frontend#1076: the pin of a link is remembered only once
		// a sign-in to its Organization admits the member.
		it('remembers the pinned Organization once its session is admitted', async () => {
			const local = window.localStorage
			const tab = window.sessionStorage
			// The link opens /?org=xx-records; its sign-in returns to the callback.
			resolveOrgPin('?org=xx-records', local, '/', tab)
			const pin = resolveOrgPin('', local, '/auth/callback', tab)
			expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()

			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{
					isAuthenticated: true,
					user: userWithRoles({ owner: { '394': PRIMARY_DOMAIN } }),
				},
				pin,
			)
			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(true)
			expect(local.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBe('xx-records')
			expect(tab.getItem(PENDING_ORG_PIN_STORAGE_KEY)).toBeNull()
			// The next visit without the link names the same Organization.
			expect(resolveOrgPin('', local, '/', tab)).toEqual(pin)
		})

		it('does not remember a pin whose sign-in returned a session of another Organization', async () => {
			resolveOrgPin(
				'?org=xx-records',
				window.localStorage,
				'/',
				window.sessionStorage,
			)
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{
					isAuthenticated: true,
					user: userWithRoles({
						owner: { '777': 'other-label.auth.liverty-music.app' },
					}),
				},
				{ kind: 'shortName', shortName: 'xx-records' },
			)

			await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(window.localStorage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		})

		it('does not write its own pin back when no sign-in is pending in the tab', async () => {
			// This tab was loaded pinned to org-a; another tab has since signed
			// in to org-b and remembered it.
			window.localStorage.setItem(ORG_ID_STORAGE_KEY, 'org-b')
			buildPinned(
				{ zitadelOrgId: 'org-a' },
				{ isAuthenticated: true, user: userOwnerInOrg('org-a') },
				{ kind: 'id', orgId: 'org-a' },
			)

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(true)
			expect(window.localStorage.getItem(ORG_ID_STORAGE_KEY)).toBe('org-b')
		})

		it('does not remember the pending pin of a failed sign-in when Back restores an earlier page', async () => {
			// The tab showed org-a's console; a link to a missing Organizer was
			// opened in it and its sign-in failed; Back restored org-a's page.
			window.localStorage.setItem(ORG_ID_STORAGE_KEY, 'org-a')
			resolveOrgPin(
				'?org=gone-records',
				window.localStorage,
				'/',
				window.sessionStorage,
			)
			buildPinned(
				{ zitadelOrgId: 'org-a' },
				{ isAuthenticated: true, user: userOwnerInOrg('org-a') },
				{ kind: 'id', orgId: 'org-a' },
			)

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(true)
			expect(window.localStorage.getItem(ORG_ID_STORAGE_KEY)).toBe('org-a')
			expect(window.localStorage.getItem(ORG_SHORT_NAME_STORAGE_KEY)).toBeNull()
		})

		it('re-authenticates a session of another Organization than the short name names', async () => {
			buildPinned(
				{ zitadelOrgPrimaryDomain: PRIMARY_DOMAIN },
				{
					isAuthenticated: true,
					user: userWithRoles({
						owner: { '777': 'other-label.auth.liverty-music.app' },
					}),
				},
			)

			const result = await sut.canLoad({} as never, {}, makeRouteNode({}), null)

			expect(result).toBe(false)
			expect(mockAuth.signIn).toHaveBeenCalledWith({
				forceLogin: true,
				uiLocales: 'ja',
			})
		})
	})
})
