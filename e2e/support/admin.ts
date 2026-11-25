import type { Page, Route } from '@playwright/test'
import { APP_ORIGIN } from './app-origin'
import { OIDC_AUTHORITY } from './auth-mocks'
import type { RpcLog, RpcMocks, RpcResult } from './organizer'

/**
 * Boots the admin console on the dev or preview server with a signed-in
 * admin and mocked admin RPCs, so functional specs need neither a live auth
 * server nor a backend.
 *
 * - Every document request is answered with `admin.html`.
 * - `/config.json` is the admin console's runtime config.
 * - The OIDC user is seeded in localStorage.
 * - Admin RPCs (Connect JSON) are answered from `rpc`; an RPC without an
 *   entry answers `{}` (an empty message).
 */

export const ADMIN_API = 'https://api.admin.e2e.liverty-music.app'
const CLIENT_ID = 'admin-e2e'

export async function installAdmin(
	page: Page,
	rpc: RpcMocks = {},
	origin = APP_ORIGIN,
): Promise<RpcLog> {
	const log: RpcLog = { calls: [] }

	await page.route(
		(url) => url.origin === origin,
		async (route: Route) => {
			if (route.request().resourceType() !== 'document') {
				return route.fallback()
			}
			const response = await route.fetch({ url: `${origin}/admin.html` })
			return route.fulfill({ response })
		},
	)

	await page.route(`${origin}/config.json`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				environment: 'dev',
				apiBaseUrl: ADMIN_API,
				adminApiBaseUrl: ADMIN_API,
				zitadelIssuer: OIDC_AUTHORITY,
				zitadelClientId: CLIENT_ID,
				zitadelOrgId: 'admin-org-e2e',
				logLevel: 'warn',
				releaseVersion: 'e2e',
				rpcTimeoutMs: 10000,
				vapidPublicKey: 'unused-by-the-admin-console',
				previewArtistIds: [],
				previewArtistNames: [],
			}),
		}),
	)

	await page.route(`${ADMIN_API}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname
		const [service, method] = path.slice(1).split('/')
		const key = `${service.split('.').at(-1)}/${method}`
		const body = (route.request().postDataJSON() ?? {}) as Record<
			string,
			unknown
		>
		log.calls.push({ method: key, body })
		const answer = rpc[key]
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
		({ authority, clientId }) => {
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
						sub: '00000000-0000-4000-8000-0000000000ad',
						name: 'Admin',
					},
					expires_at: 9999999999,
				}),
			)
		},
		{ authority: OIDC_AUTHORITY, clientId: CLIENT_ID },
	)

	return log
}
