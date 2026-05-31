import { DI } from 'aurelia'
import { KNOWN_HOSTS } from './known-hosts'

export { KNOWN_HOSTS } from './known-hosts'

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
	/**
	 * PostHog Cloud EU ingestion host. Optional — when omitted the
	 * AnalyticsService falls back to the EU default
	 * (`https://eu.i.posthog.com`). Kept independent from
	 * `posthogProjectKey` so a future regional override can flip the host
	 * without forcing a key rotation.
	 */
	readonly posthogApiHost?: string
	/**
	 * PostHog public project API key. Optional — when omitted (or empty)
	 * the AnalyticsService runs in nil-config mode: no SDK init, no
	 * network calls, every capture is debug-logged and dropped. Mirrors
	 * the backend's `client == nil` posture so missing analytics never
	 * breaks the product surface. The cloud-provisioning ConfigMap that
	 * serves `/config.json` will populate this in a follow-up PR.
	 */
	readonly posthogProjectKey?: string
}

export const IAppConfig = DI.createInterface<AppConfig>('IAppConfig')

const VALID_ENVIRONMENTS = ['dev', 'staging', 'prod'] as const
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const

let _config: AppConfig | null = null
let _inflight: Promise<AppConfig> | null = null

/** Bounded wall-clock for the bootstrap `/config.json` fetch so a hung
 *  endpoint fails closed (showStaticErrorPage) within a known window
 *  rather than leaving the user staring at a blank page indefinitely. */
const CONFIG_FETCH_TIMEOUT_MS = 5_000

/**
 * Fetches `/config.json`, validates the schema, and caches the result for
 * synchronous access via {@link getAppConfig}. MUST be awaited before
 * `Aurelia.start()` and before any module-level code that calls
 * `getAppConfig()` evaluates.
 */
export function loadAppConfig(): Promise<AppConfig> {
	if (_config) return Promise.resolve(_config)
	if (_inflight) return _inflight
	_inflight = doLoadAppConfig().finally(() => {
		_inflight = null
	})
	return _inflight
}

async function doLoadAppConfig(): Promise<AppConfig> {
	const res = await fetch('/config.json', {
		cache: 'no-store',
		signal: AbortSignal.timeout(CONFIG_FETCH_TIMEOUT_MS),
	})
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
	const final = import.meta.env.DEV ? await applyLocalOverride(config) : config
	_config = final
	return final
}

/**
 * Dev-only: merge an optional gitignored `/config.local.json` over the bundled
 * config so a developer can point the app at a local backend without editing
 * the tracked `config.json`. The typical override is `{ "apiBaseUrl": "/" }`,
 * which routes RPC calls same-origin through the Vite dev proxy (see
 * `VITE_DEV_API_TARGET` in `vite.config.ts`). A missing file is ignored.
 * This branch is dead-code-eliminated from production builds.
 */
async function applyLocalOverride(config: AppConfig): Promise<AppConfig> {
	let res: Response
	try {
		res = await fetch('/config.local.json', {
			cache: 'no-store',
			signal: AbortSignal.timeout(CONFIG_FETCH_TIMEOUT_MS),
		})
	} catch {
		return config
	}
	if (!res.ok) return config
	let override: unknown
	try {
		override = await res.json()
	} catch {
		return config
	}
	if (
		override === null ||
		typeof override !== 'object' ||
		Array.isArray(override)
	) {
		return config
	}
	const o = override as Record<string, unknown>
	// Only scalar endpoint/identity fields are overridable for local dev.
	const overrides: Record<string, string> = {}
	for (const key of ['apiBaseUrl', 'environment', 'zitadelIssuer'] as const) {
		const v = o[key]
		if (typeof v === 'string') overrides[key] = v
	}
	return { ...config, ...overrides } as AppConfig
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

	// posthogApiHost / posthogProjectKey are optional and absent from
	// every existing ConfigMap until cloud-provisioning's follow-up PR
	// lands. `readOptionalString` returns undefined (not '') for missing
	// keys so AnalyticsService can distinguish "not yet configured" from
	// "explicitly disabled".
	const posthogApiHost = readOptionalString(o, 'posthogApiHost')
	const posthogProjectKey = readOptionalString(o, 'posthogProjectKey')

	return {
		environment: env as AppConfig['environment'],
		apiBaseUrl: requireString(o, 'apiBaseUrl'),
		zitadelIssuer: requireString(o, 'zitadelIssuer'),
		zitadelClientId: requireString(o, 'zitadelClientId'),
		zitadelOrgId: requireString(o, 'zitadelOrgId'),
		vapidPublicKey: requireString(o, 'vapidPublicKey'),
		// circuitBaseUrl is the ONLY required-present-but-MAY-be-empty
		// string in the schema — empty signals "ZK circuits unavailable
		// in this environment" per the frontend-runtime-config spec.
		// All other required fields use requireString (rejects empty).
		circuitBaseUrl: optionalString(o, 'circuitBaseUrl'),
		previewArtistIds,
		previewArtistNames,
		logLevel: logLevel as AppConfig['logLevel'],
		...(posthogApiHost !== undefined ? { posthogApiHost } : {}),
		...(posthogProjectKey !== undefined ? { posthogProjectKey } : {}),
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

/**
 * Returns `undefined` when the key is absent or null; rejects
 * non-string values loudly so a malformed ConfigMap surfaces during
 * boot rather than at first analytics call. Empty string is preserved
 * as-is — AnalyticsService treats `''` and `undefined` identically for
 * the nil-config gate, but keeping the distinction here lets a future
 * inspector tell "the key is set to empty deliberately" from "the key
 * was forgotten" in the wild config dump.
 */
function readOptionalString(
	o: Record<string, unknown>,
	key: string,
): string | undefined {
	const v = o[key]
	if (v === undefined || v === null) return undefined
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

/**
 * Test-only: clears the cached config so each unit test starts fresh.
 * @internal Not part of the public API; the `__` prefix and this tag
 *   discourage import from production code. Follow-up: migrate to a
 *   Vitest `vi.mock`-based reset pattern to remove from the prod bundle.
 */
export function __resetAppConfigForTests(): void {
	_config = null
	_inflight = null
}
