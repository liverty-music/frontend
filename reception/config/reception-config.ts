import { DI } from 'aurelia'

/**
 * Shape of the reception app's runtime `/config.json`, fetched at bootstrap
 * and registered as a DI singleton via {@link IReceptionConfig}.
 *
 * Deliberately NOT the console/consumer `AppConfig` (`shared/config/app-config`):
 * the reception app has no sign-in, so its config carries no Zitadel issuer,
 * client id or org id. It holds only where ReceptionService is served
 * (`api.reception.<domain>`), the environment and the log level. See OpenSpec
 * change `isolate-venue-reception`, design D4.
 */
export interface ReceptionConfig {
	readonly environment: 'dev' | 'staging' | 'prod'
	/** Base URL of the reception API, e.g. `https://api.reception.liverty-music.app`. */
	readonly apiBaseUrl: string
	readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'
}

export const IReceptionConfig =
	DI.createInterface<ReceptionConfig>('IReceptionConfig')

const VALID_ENVIRONMENTS = ['dev', 'staging', 'prod'] as const
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const
const KNOWN_KEYS: readonly string[] = ['environment', 'apiBaseUrl', 'logLevel']

/** Bounded wall-clock for the bootstrap fetch, so a hung endpoint fails closed. */
const CONFIG_FETCH_TIMEOUT_MS = 5_000

/** Fetches `/config.json` and validates it. Must resolve before `Aurelia.start()`. */
export async function loadReceptionConfig(
	fetchImpl: typeof fetch = fetch,
): Promise<ReceptionConfig> {
	const res = await fetchImpl('/config.json', {
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
	return validateReceptionConfig(parsed)
}

/**
 * Validates the reception config document. Unknown fields are rejected: a
 * console config mounted here by mistake (it carries Zitadel fields and the
 * organizer API base URL) must stop the app rather than point reception calls
 * at the wrong API.
 */
export function validateReceptionConfig(parsed: unknown): ReceptionConfig {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('config.json: top-level value must be a JSON object')
	}
	const o = parsed as Record<string, unknown>

	const unknown = Object.keys(o).filter((k) => !KNOWN_KEYS.includes(k))
	if (unknown.length > 0) {
		throw new Error(
			`config.json: unexpected field(s) for the reception app: ${unknown.join(', ')}`,
		)
	}

	const environment = requireString(o, 'environment')
	if (!(VALID_ENVIRONMENTS as readonly string[]).includes(environment)) {
		throw new Error(
			`config.json: environment must be one of ${VALID_ENVIRONMENTS.join('|')}, got '${environment}'`,
		)
	}

	const logLevel = requireString(o, 'logLevel')
	if (!(VALID_LOG_LEVELS as readonly string[]).includes(logLevel)) {
		throw new Error(
			`config.json: logLevel must be one of ${VALID_LOG_LEVELS.join('|')}, got '${logLevel}'`,
		)
	}

	return {
		environment: environment as ReceptionConfig['environment'],
		apiBaseUrl: requireString(o, 'apiBaseUrl'),
		logLevel: logLevel as ReceptionConfig['logLevel'],
	}
}

function requireString(o: Record<string, unknown>, key: string): string {
	const v = o[key]
	if (typeof v !== 'string' || v.length === 0) {
		throw new Error(`config.json missing or empty required field: ${key}`)
	}
	return v
}
