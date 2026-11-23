/**
 * Single source of truth for the well-known production-tier hostnames
 * and the environment each one MUST serve.
 *
 * This module is deliberately kept Vite/Aurelia-free so it can be
 * imported from any context — bootstrap, Playwright specs (which run
 * outside the Vite pipeline), unit tests, or build scripts — without
 * pulling in `import.meta.env`, DI, or other Vite-specific bindings.
 *
 * Add a new hostname here when introducing a new environment; the
 * bootstrap cross-check and the post-deploy smoke spec both consume
 * this map, so adding once propagates everywhere.
 */
export type KnownEnvironment = 'dev' | 'staging' | 'prod'

export const KNOWN_HOSTS: Readonly<Record<string, KnownEnvironment>> = {
	'liverty-music.app': 'prod',
	// Production's preview address: a release waiting for promotion is served
	// here before fans receive it. It must stay after `liverty-music.app`, so
	// `fanOriginOf('prod')` keeps returning the fans' origin.
	'preview.liverty-music.app': 'prod',
	'dev.liverty-music.app': 'dev',
	'staging.liverty-music.app': 'staging',
}

/**
 * The fan app's origin in an environment (`https://liverty-music.app` in
 * prod): the hostname this map assigns to it. The organizer console builds a
 * published event's fan page address from it.
 */
export function fanOriginOf(environment: KnownEnvironment): string | undefined {
	const host = Object.keys(KNOWN_HOSTS).find(
		(name) => KNOWN_HOSTS[name] === environment,
	)
	return host ? `https://${host}` : undefined
}

/** The host that serves a release waiting for promotion (production only). */
export const PREVIEW_HOST = 'preview.liverty-music.app'

/**
 * The API address a page loaded from {@link PREVIEW_HOST} calls. The same
 * files serve the production address after promotion, so the choice is made
 * from the page's host, not from a value fixed in `/config.json`.
 */
export const PREVIEW_API_BASE_URL = 'https://api.preview.liverty-music.app'
