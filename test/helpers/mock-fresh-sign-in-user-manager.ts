import { type User, UserManager } from 'oidc-client-ts'
import { vi } from 'vitest'

/**
 * A stand-in for the fresh sign-in's oidc-client-ts `UserManager`. The test
 * file must mock `oidc-client-ts` so `UserManager` is a `vi.fn()`; this makes
 * every `new UserManager()` return the stand-in.
 *
 * `signInAs(sub, authTime)` sets what the hosted login returns on the next
 * callback: the identity, when it last authenticated, and the request state
 * of the last `signinRedirect` (as oidc-client-ts hands it back).
 */
export function mockFreshSignInUserManager() {
	let next: User | null = null
	let state: unknown
	const manager = {
		signinRedirect: vi.fn(async (args?: { state?: unknown }) => {
			state = args?.state
		}),
		signinCallback: vi.fn(async () =>
			next ? ({ ...next, state } as unknown as User) : null,
		),
		removeUser: vi.fn(async () => {}),
		signInAs(sub: string, authTimeSec = Math.floor(Date.now() / 1000)) {
			next = {
				profile: { sub, auth_time: authTimeSec },
				access_token: 'passkey-token',
				id_token: 'fresh-id-token',
				expired: false,
			} as unknown as User
		},
	}
	// Vitest 4 invokes a mocked class's implementation via `new`, so it must be
	// a constructable function expression.
	// biome-ignore lint/complexity/useArrowFunction: must stay constructable for `new`
	vi.mocked(UserManager).mockImplementation(function () {
		return manager as unknown as UserManager
	} as unknown as typeof UserManager)
	return manager
}
