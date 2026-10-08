/**
 * Service-worker fallbacks that let a fan reopen the app without a connection
 * (the tickets screen shows the last loaded list and makes entry QR codes
 * offline). Both are network-first: online behavior is unchanged, and the
 * fallback is used only when the network request fails.
 */

/** Cache Storage bucket holding the last `/config.json` read online. */
export const OFFLINE_CONFIG_CACHE = 'liverty-config-offline'

export interface FallbackDeps {
	fetchImpl?: typeof fetch
	cacheStorage?: CacheStorage
}

/**
 * Navigation: go to the network; when it fails, serve the app shell so the
 * client-side router can open the route (e.g. `/tickets`) offline.
 */
export async function navigateOrShell(
	request: Request,
	shell: () => Promise<Response | undefined>,
	deps: FallbackDeps = {},
): Promise<Response> {
	const fetchImpl = deps.fetchImpl ?? fetch
	try {
		return await fetchImpl(request)
	} catch (err) {
		const fallback = await shell()
		if (fallback) return fallback
		throw err
	}
}

/**
 * `/config.json`: always read from the network and keep the last good copy;
 * serve that copy only when the network fails, so an operator change still
 * reaches every online boot.
 */
export async function configNetworkFirst(
	request: Request,
	deps: FallbackDeps = {},
): Promise<Response> {
	const fetchImpl = deps.fetchImpl ?? fetch
	const cacheStorage = deps.cacheStorage ?? caches
	try {
		const response = await fetchImpl(request, { cache: 'no-store' })
		if (response.ok) {
			const cache = await cacheStorage.open(OFFLINE_CONFIG_CACHE)
			await cache.put(request.url, response.clone())
		}
		return response
	} catch (err) {
		const cache = await cacheStorage.open(OFFLINE_CONFIG_CACHE)
		const cached = await cache.match(request.url)
		if (cached) return cached
		throw err
	}
}
