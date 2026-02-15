import type { Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { resolve } from 'aurelia'
import { IAuthService } from './auth-service'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

// Lazily resolve AuthService to avoid circular dependencies
let authService: ReturnType<typeof resolve<IAuthService>> | null = null

const getAuthService = () => {
	if (!authService) {
		authService = resolve(IAuthService)
	}
	return authService
}

/**
 * Interceptor to inject JWT token from OIDC UserManager.
 * Uses AuthService.getUserManager() to retrieve the current user,
 * avoiding direct dependency on oidc-client-ts internal storage format.
 */
const authInterceptor: Interceptor = (next) => async (req) => {
	try {
		const auth = getAuthService()
		const user = await auth.getUserManager().getUser()

		if (user?.access_token) {
			req.header.set('Authorization', `Bearer ${user.access_token}`)
		}
	} catch (err) {
		console.error('Failed to get user from UserManager', err)
	}

	return await next(req)
}

export const transport = createConnectTransport({
	baseUrl,
	interceptors: [authInterceptor],
})
