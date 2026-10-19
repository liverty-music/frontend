/**
 * Service-worker fallbacks that let a fan reopen the app without a connection
 * (the tickets screen shows the last loaded list and makes entry QR codes
 * offline). Navigation is network-first; `/config.json` is served from the
 * kept copy and refreshed in the background.
 */

/** Cache Storage bucket holding the last `/config.json` read online. */
export const OFFLINE_CONFIG_CACHE = 'config-offline'

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
 * `/config.json`: serve the kept copy at once and refresh it from the network
 * for the next start (stale-while-revalidate), so start-up does not wait a
 * round trip (1.4 s on Slow 4G). With no kept copy, wait for the network and
 * keep its answer; a failed network then fails like the network. A config
 * change made without an app release reaches a device one start later; a
 * release drops the kept copy (see `sw.ts` activate), so new code never starts
 * with an old config. `waitUntil` keeps the worker alive for the refresh.
 */
export async function configStaleWhileRevalidate(
	request: Request,
	waitUntil: (work: Promise<unknown>) => void,
	deps: FallbackDeps = {},
): Promise<Response> {
	const fetchImpl = deps.fetchImpl ?? fetch
	const cache = await (deps.cacheStorage ?? caches).open(OFFLINE_CONFIG_CACHE)
	const fromNetwork = fetchImpl(request, { cache: 'no-store' }).then(
		async (response) => {
			if (response.ok) await cache.put(request.url, response.clone())
			return response
		},
	)
	const kept = await cache.match(request.url)
	if (kept) {
		waitUntil(fromNetwork.catch(() => undefined))
		return kept
	}
	return fromNetwork
}
