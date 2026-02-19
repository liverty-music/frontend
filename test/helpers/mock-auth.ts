import type { User } from 'oidc-client-ts'
import { vi } from 'vitest'
import type { IAuthService } from '../../src/services/auth-service'

export interface MockAuthConfig {
	isAuthenticated?: boolean
	user?: User | null
	ready?: Promise<void>
}

/**
 * Creates a mock implementation of IAuthService for testing.
 * All methods are Vitest spy functions.
 *
 * @param config - Configuration for initial mock state
 */
export function createMockAuth(
	config: MockAuthConfig = {},
): Partial<IAuthService> {
	const defaultReady = Promise.resolve()

	const mockAuth = {
		user: config.user ?? null,
		isAuthenticated: config.isAuthenticated ?? false,
		ready: config.ready ?? defaultReady,
		signIn: vi.fn().mockResolvedValue(undefined),
		signUp: vi.fn().mockResolvedValue(undefined),
		signOut: vi.fn().mockResolvedValue(undefined),
		handleCallback: vi.fn().mockResolvedValue({
			profile: { preferred_username: 'test-user' },
		} as User),
		getUserManager: vi.fn().mockReturnValue({
			getUser: vi.fn().mockResolvedValue(null),
		}),
	}

	return mockAuth as Partial<IAuthService>
}
