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
	'dev.liverty-music.app': 'dev',
	'staging.liverty-music.app': 'staging',
}
