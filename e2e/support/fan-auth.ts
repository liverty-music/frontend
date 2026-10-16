import type { Page, Route } from '@playwright/test'
import { OIDC_AUTHORITY } from './auth-mocks'

/**
 * Fan-app helpers for specs that sign up or boot signed in against a mocked
 * backend: a mocked identity provider that completes the OIDC round trip, a
 * signed-in seed, and an RPC mock that records every call.
 */

/** The fan's OIDC subject in these fixtures. */
export const FAN_SUB = '00000000-0000-4000-8000-d00000000002'
export const FAN_EMAIL = 'fan@example.com'
/** Must match `public/config.json` `zitadelClientId`. */
export const FAN_CLIENT_ID = '371355407710421859'

function base64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function unsignedIdToken(clientId: string): string {
	const now = Math.floor(Date.now() / 1000)
	return [
		base64url({ alg: 'none', typ: 'JWT' }),
		base64url({
			iss: OIDC_AUTHORITY,
			aud: clientId,
			sub: FAN_SUB,
			email: FAN_EMAIL,
			iat: now,
			exp: now + 3600,
		}),
		'',
	].join('.')
}

/**
 * Answer the authorize request with a redirect back to the app's callback, and
 * the token request with an unsigned ID token (oidc-client-ts does not verify
 * signatures), so a sign-up or sign-in completes without an identity provider.
 */
export async function mockIdentityProvider(page: Page): Promise<void> {
	await page.route(`${OIDC_AUTHORITY}/oauth/v2/authorize**`, (route) => {
		const authorize = new URL(route.request().url())
		const callback = new URL(authorize.searchParams.get('redirect_uri') ?? '')
		callback.searchParams.set('code', 'fake-code')
		callback.searchParams.set(
			'state',
			authorize.searchParams.get('state') ?? '',
		)
		return route.fulfill({
			status: 302,
			headers: { location: callback.toString() },
		})
	})
	await page.route(`${OIDC_AUTHORITY}/oauth/v2/token`, (route) => {
		const form = new URLSearchParams(route.request().postData() ?? '')
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				access_token: 'fake-access-token',
				token_type: 'Bearer',
				expires_in: 3600,
				scope: 'openid profile email',
				id_token: unsignedIdToken(form.get('client_id') ?? ''),
			}),
		})
	})
}

/**
 * An init script that stores a signed-in fan the way oidc-client-ts does, so
 * the app boots authenticated. Self-contained: Playwright serializes it.
 */
export function seedSignedIn({
	sub,
	email,
}: {
	sub: string
	email: string
}): void {
	localStorage.setItem(
		'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
		JSON.stringify({
			id_token: 'fake-id-token',
			access_token: 'fake-access-token',
			token_type: 'Bearer',
			scope: 'openid profile email',
			profile: { sub, email },
			expires_at: 9999999999,
		}),
	)
}

/** One recorded RPC: `Service/Method` and its JSON request body. */
export interface RpcCall {
	method: string
	body: Record<string, unknown>
}

/** A mock answer: a JSON body, or a function of the request body. */
export type FanRpcAnswer =
	| Record<string, unknown>
	| ((
			body: Record<string, unknown>,
			route: Route,
	  ) => Promise<RpcReply | undefined> | RpcReply | undefined)

/** A full answer, for errors: a status with a Connect error body. */
export interface RpcReply {
	status?: number
	body: Record<string, unknown>
}

/** A Connect JSON error reply. */
export function connectError(code: string, status: number): RpcReply {
	return { status, body: { code, message: code } }
}

/**
 * Mock every fan RPC: `answers` keyed by `Service/Method` (e.g.
 * `FollowService/Follow`), everything else answers `{}`. Returns the calls in
 * the order they were made.
 */
export async function mockFanRpc(
	page: Page,
	answers: Record<string, FanRpcAnswer> = {},
): Promise<RpcCall[]> {
	const calls: RpcCall[] = []
	await page.route('**/liverty_music.rpc.**', async (route) => {
		const url = new URL(route.request().url())
		const method = url.pathname.split('/').slice(-2).join('/').split('.').pop()
		const key = method ?? ''
		let body: Record<string, unknown> = {}
		try {
			body = JSON.parse(route.request().postData() ?? '{}')
		} catch {
			body = {}
		}
		calls.push({ method: key, body })
		const answer = answers[key]
		let reply: RpcReply | undefined
		if (typeof answer === 'function') reply = await answer(body, route)
		else if (answer) reply = { body: answer }
		return route.fulfill({
			status: reply?.status ?? 200,
			contentType: 'application/json',
			body: JSON.stringify(reply?.body ?? {}),
		})
	})
	return calls
}

/** The calls of one method, in order. */
export function callsOf(calls: RpcCall[], method: string): RpcCall[] {
	return calls.filter((c) => c.method === method)
}
