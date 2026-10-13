import type { Page, Route } from '@playwright/test'
import { OIDC_AUTHORITY } from './auth-mocks'

/**
 * Boots the organizer console on the dev server with a signed-in owner and
 * mocked organizer RPCs, so functional specs need neither a live auth server
 * nor a backend.
 *
 * - Every document request is answered with `organizer.html`, so a deep
 *   address such as `/concerts/s1` opens the console (the dev server would
 *   otherwise serve the fan app's `index.html`).
 * - `/config.json` is the organizer's runtime config.
 * - The OIDC user is seeded in localStorage with the `owner` project role.
 * - Organizer RPCs (Connect JSON) are answered from `rpc`; an RPC without an
 *   entry answers `{}` (an empty message).
 */

export const ORGANIZER_API = 'https://api.organizer.e2e.liverty-music.app'
const CLIENT_ID = 'organizer-e2e'
const ORG_ID = 'org-e2e'

/** A mocked RPC answer: a JSON body, or a function of the request body. */
export type RpcAnswer =
	| Record<string, unknown>
	| ((request: Record<string, unknown>) => RpcResult | Promise<RpcResult>)

/** A full answer with a status, for errors (Connect error JSON). */
export interface RpcResult {
	status?: number
	body: Record<string, unknown>
}

/** RPC answers keyed by `<Service>/<Method>`, e.g. `SeriesService/List`. */
export type RpcMocks = Record<string, RpcAnswer>

export interface ConsoleOptions {
	rpc?: RpcMocks
	/** Language saved on the device; omit to use the browser's language. */
	language?: 'ja' | 'en'
	/** False seeds a signed-in account without the owner role. */
	owner?: boolean
}

/** Requests received by the mocked RPCs, in order, for assertions. */
export interface RpcLog {
	calls: Array<{ method: string; body: Record<string, unknown> }>
}

export async function installConsole(
	page: Page,
	options: ConsoleOptions = {},
): Promise<RpcLog> {
	const log: RpcLog = { calls: [] }

	await page.route(
		(url) => url.origin === 'http://localhost:9000',
		async (route: Route) => {
			if (route.request().resourceType() !== 'document') {
				return route.fallback()
			}
			const response = await route.fetch({
				url: 'http://localhost:9000/organizer.html',
			})
			return route.fulfill({ response })
		},
	)

	await page.route('http://localhost:9000/config.json', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				environment: 'dev',
				apiBaseUrl: ORGANIZER_API,
				zitadelIssuer: OIDC_AUTHORITY,
				zitadelClientId: CLIENT_ID,
				receptionBaseUrl: 'https://reception.e2e.liverty-music.app',
				logLevel: 'warn',
				releaseVersion: 'e2e',
				rpcTimeoutMs: 10000,
				vapidPublicKey: 'unused-by-the-console',
				previewArtistIds: [],
				previewArtistNames: [],
			}),
		}),
	)

	await page.route(`${ORGANIZER_API}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname
		// `/liverty_music.rpc.organizer.series.v1.SeriesService/List`
		const [service, method] = path.slice(1).split('/')
		const key = `${service.split('.').at(-1)}/${method}`
		const body = (route.request().postDataJSON() ?? {}) as Record<
			string,
			unknown
		>
		log.calls.push({ method: key, body })

		const answer = options.rpc?.[key]
		const result: RpcResult =
			typeof answer === 'function' ? await answer(body) : { body: answer ?? {} }
		return route.fulfill({
			status: result.status ?? 200,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: JSON.stringify(result.body),
		})
	})

	await page.addInitScript(
		({ authority, clientId, orgId, language, owner }) => {
			// Seed once per tab: a later load (reload, back after sign-out) sees
			// whatever the console left in storage.
			if (sessionStorage.getItem('e2e:seeded')) return
			sessionStorage.setItem('e2e:seeded', '1')
			localStorage.setItem(
				`oidc.user:${authority}:${clientId}`,
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: {
						sub: '00000000-0000-4000-8000-0000000000e2',
						name: 'Owner',
						...(owner
							? {
									'urn:zitadel:iam:org:project:roles': {
										owner: { [orgId]: 'e2e.liverty-music.app' },
									},
								}
							: {}),
					},
					expires_at: 9999999999,
				}),
			)
			if (language) localStorage.setItem('organizer.language', language)
		},
		{
			authority: OIDC_AUTHORITY,
			clientId: CLIENT_ID,
			orgId: ORG_ID,
			language: options.language,
			owner: options.owner ?? true,
		},
	)

	return log
}

/** The console origin's localStorage, readable after the page left it. */
export async function consoleStorage(
	page: Page,
): Promise<Record<string, string>> {
	const state = await page.context().storageState()
	const origin = state.origins.find((o) => o.origin === 'http://localhost:9000')
	return Object.fromEntries(
		(origin?.localStorage ?? []).map((e) => [e.name, e.value]),
	)
}

/** A Connect error body, for `RpcResult`. */
export function connectError(
	code: string,
	message = code,
	status = 400,
): RpcResult {
	return { status, body: { code, message } }
}
