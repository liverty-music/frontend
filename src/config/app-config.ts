import { DI } from 'aurelia'

/**
 * Shape of `/config.json` — the runtime environment configuration document
 * fetched at bootstrap and registered as a DI singleton via `IAppConfig`.
 *
 * Single source of truth for the contract between the SPA bundle and any
 * environment that serves `/config.json`. See `frontend-runtime-config`
 * capability spec for the normative requirements.
 */
export interface AppConfig {
	readonly environment: 'dev' | 'staging' | 'prod'
	readonly apiBaseUrl: string
	readonly zitadelIssuer: string
	readonly zitadelClientId: string
	readonly zitadelOrgId: string
	readonly vapidPublicKey: string
	readonly circuitBaseUrl: string
	readonly previewArtistIds: readonly string[]
	readonly previewArtistNames: readonly string[]
	readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'
}

export const IAppConfig = DI.createInterface<AppConfig>('IAppConfig')

const KNOWN_HOSTS: Readonly<Record<string, AppConfig['environment']>> = {
	'liverty-music.app': 'prod',
	'dev.liverty-music.app': 'dev',
	'staging.liverty-music.app': 'staging',
}

const VALID_ENVIRONMENTS = ['dev', 'staging', 'prod'] as const
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const

let _config: AppConfig | null = null

/**
 * Fetches `/config.json`, validates the schema, and caches the result for
 * synchronous access via {@link getAppConfig}. MUST be awaited before
 * `Aurelia.start()` and before any module-level code that calls
 * `getAppConfig()` evaluates.
 */
export async function loadAppConfig(): Promise<AppConfig> {
	const res = await fetch('/config.json', { cache: 'no-store' })
	if (!res.ok) {
		throw new Error(
			`config.json fetch failed: HTTP ${res.status} ${res.statusText}`,
		)
	}
	let parsed: unknown
	try {
		parsed = await res.json()
	} catch (err) {
		throw new Error(
			`config.json parse failed: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	const config = validateAppConfig(parsed)
	_config = config
	return config
}

/**
 * Returns the cached config. Throws if {@link loadAppConfig} has not yet
 * resolved. Used by module-scoped code in lazy route chunks that evaluate
 * after bootstrap completes (e.g., {@link ../constants/preview-artists}).
 */
export function getAppConfig(): AppConfig {
	if (!_config) {
		throw new Error(
			'Runtime config not loaded — loadAppConfig() must resolve before getAppConfig() is called. Check bootstrap order in main.ts.',
		)
	}
	return _config
}

/**
 * Refuses to proceed if the page is served from a well-known environment
 * hostname whose expected environment disagrees with `config.environment`.
 * Catches the failure mode where a non-dev pod accidentally serves the
 * image's bundled dev fallback config instead of the mounted ConfigMap.
 */
export function validateEnvironmentMatchesHost(config: AppConfig): void {
	if (typeof window === 'undefined') return
	const host = window.location.hostname
	const expected = KNOWN_HOSTS[host]
	if (expected !== undefined && config.environment !== expected) {
		throw new Error(
			`Config environment mismatch: host '${host}' expects environment '${expected}', but config.json says '${config.environment}'. Likely a misconfigured ConfigMap mount.`,
		)
	}
}

function validateAppConfig(parsed: unknown): AppConfig {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('config.json: top-level value must be a JSON object')
	}
	const o = parsed as Record<string, unknown>

	const env = requireString(o, 'environment')
	if (!(VALID_ENVIRONMENTS as readonly string[]).includes(env)) {
		throw new Error(
			`config.json: environment must be one of ${VALID_ENVIRONMENTS.join('|')}, got '${env}'`,
		)
	}

	const logLevel = requireString(o, 'logLevel')
	if (!(VALID_LOG_LEVELS as readonly string[]).includes(logLevel)) {
		throw new Error(
			`config.json: logLevel must be one of ${VALID_LOG_LEVELS.join('|')}, got '${logLevel}'`,
		)
	}

	const previewArtistIds = requireStringArray(o, 'previewArtistIds')
	const previewArtistNames = requireStringArray(o, 'previewArtistNames')
	if (previewArtistIds.length !== previewArtistNames.length) {
		throw new Error(
			`config.json: previewArtistIds (${previewArtistIds.length}) and previewArtistNames (${previewArtistNames.length}) length mismatch`,
		)
	}

	return {
		environment: env as AppConfig['environment'],
		apiBaseUrl: requireString(o, 'apiBaseUrl'),
		zitadelIssuer: requireString(o, 'zitadelIssuer'),
		zitadelClientId: requireString(o, 'zitadelClientId'),
		zitadelOrgId: requireString(o, 'zitadelOrgId'),
		vapidPublicKey: requireString(o, 'vapidPublicKey'),
		circuitBaseUrl: optionalString(o, 'circuitBaseUrl'),
		previewArtistIds,
		previewArtistNames,
		logLevel: logLevel as AppConfig['logLevel'],
	}
}

function requireString(o: Record<string, unknown>, key: string): string {
	const v = o[key]
	if (typeof v !== 'string' || v.length === 0) {
		throw new Error(`config.json missing or empty required field: ${key}`)
	}
	return v
}

function optionalString(o: Record<string, unknown>, key: string): string {
	const v = o[key]
	if (v === undefined || v === null) return ''
	if (typeof v !== 'string') {
		throw new Error(`config.json field '${key}' must be a string`)
	}
	return v
}

function requireStringArray(
	o: Record<string, unknown>,
	key: string,
): readonly string[] {
	const v = o[key]
	if (!Array.isArray(v)) {
		throw new Error(`config.json field '${key}' must be an array`)
	}
	for (const item of v) {
		if (typeof item !== 'string') {
			throw new Error(
				`config.json field '${key}' contains a non-string element`,
			)
		}
	}
	return v as string[]
}

/** Test-only: clears the cached config so each unit test starts fresh. */
export function __resetAppConfigForTests(): void {
	_config = null
}
