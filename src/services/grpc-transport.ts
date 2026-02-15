import type { Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

// Interceptor to inject JWT token from session storage
const authInterceptor: Interceptor = (next) => async (req) => {
	// Get the OIDC user from session storage (managed by oidc-client-ts)
	const oidcStorageKey = `oidc.user:${import.meta.env.VITE_ZITADEL_ISSUER}:${import.meta.env.VITE_ZITADEL_CLIENT_ID}`
	const userJson = sessionStorage.getItem(oidcStorageKey)

	if (userJson) {
		try {
			const user = JSON.parse(userJson)
			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
			}
		} catch (err) {
			console.error('Failed to parse OIDC user from storage', err)
		}
	}

	return await next(req)
}

export const transport = createConnectTransport({
	baseUrl,
	interceptors: [authInterceptor],
})
