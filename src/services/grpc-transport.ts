import type { Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import type { IAuthService } from './auth-service'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

/**
 * Creates a Connect transport with authentication interceptor.
 *
 * This factory function accepts IAuthService as a dependency to avoid
 * calling resolve() outside of a DI resolution context, which would
 * cause AUR0002 errors in Aurelia 2.
 *
 * @param auth - The AuthService instance to use for retrieving JWT tokens
 * @returns A configured Connect transport with auth interceptor
 */
export const createTransport = (auth: IAuthService) => {
	/**
	 * Interceptor to inject JWT token from OIDC UserManager.
	 * Uses AuthService.getUserManager() to retrieve the current user,
	 * avoiding direct dependency on oidc-client-ts internal storage format.
	 */
	const authInterceptor: Interceptor = (next) => async (req) => {
		try {
			const user = await auth.getUserManager().getUser()

			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
			}
		} catch (err) {
			console.error('Failed to get user from UserManager', err)
		}

		return await next(req)
	}

	return createConnectTransport({
		baseUrl,
		interceptors: [authInterceptor],
	})
}
