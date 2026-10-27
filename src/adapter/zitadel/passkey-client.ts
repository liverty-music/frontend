import { DI, resolve } from 'aurelia'
import { IAppConfig } from '../../config/app-config'
import {
	type FreshSignInSession,
	IFreshSignInService,
} from '../../services/fresh-sign-in-service'

/** One passkey registered for the fan's identity at the identity provider. */
export interface Passkey {
	readonly id: string
	/** The name the hosted login gave it (from the user agent); may be empty. */
	readonly name: string
}

/** Why a call to the identity provider's API failed. */
export type PasskeyRequestFailure = 'unauthenticated' | 'failed'

/** A failed call to the identity provider's passkey API. */
export class PasskeyRequestError extends Error {
	constructor(
		public readonly failure: PasskeyRequestFailure,
		message: string,
	) {
		super(message)
		this.name = 'PasskeyRequestError'
	}
}

/** User v2 `Passkey` as JSON (proto3 JSON: zero values omitted). */
interface PasskeyJson {
	id?: string
	state?: string
	name?: string
}

/**
 * Factor states that are not a usable passkey: a registration that was
 * started but not finished, or one already removed.
 */
const UNUSABLE_STATES = new Set([
	'AUTH_FACTOR_STATE_NOT_READY',
	'AUTH_FACTOR_STATE_REMOVED',
])

export const IPasskeyClient = DI.createInterface<IPasskeyClient>(
	'IPasskeyClient',
	(x) => x.singleton(PasskeyClient),
)

export interface IPasskeyClient extends PasskeyClient {}

/**
 * The identity provider's User v2 REST API for the fan's own passkeys
 * (ZITADEL v4.19.5, `proto/zitadel/user/v2/user_service.proto`):
 * - ListPasskeys: `POST /v2/users/{user_id}/passkeys/_search`
 * - RemovePasskey: `DELETE /v2/users/{user_id}/passkeys/{passkey_id}`
 *
 * Every call carries the passkey-management token (design D3) and acts on that
 * token's own identity, so no service account is involved. Only the
 * `authorization` and `content-type` headers are sent, which the identity
 * provider's CORS preflight allows for any origin.
 */
export class PasskeyClient {
	private readonly baseUrl = resolve(IAppConfig).zitadelIssuer.replace(
		/\/+$/,
		'',
	)
	private readonly freshSignIn = resolve(IFreshSignInService)

	/** Every usable passkey of the fan's identity. */
	public async list(): Promise<Passkey[]> {
		const session = this.requireSession()
		const body = (await this.call(
			session,
			`${this.passkeysUrl(session)}/_search`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			},
		)) as { result?: PasskeyJson[] }
		return (body.result ?? [])
			.filter((p) => p.id && !UNUSABLE_STATES.has(p.state ?? ''))
			.map((p) => ({ id: p.id as string, name: p.name ?? '' }))
	}

	/** Remove one passkey from the fan's identity. */
	public async remove(passkeyId: string): Promise<void> {
		const session = this.requireSession()
		await this.call(
			session,
			`${this.passkeysUrl(session)}/${encodeURIComponent(passkeyId)}`,
			{ method: 'DELETE' },
		)
	}

	private passkeysUrl(session: FreshSignInSession): string {
		return `${this.baseUrl}/v2/users/${encodeURIComponent(session.userId)}/passkeys`
	}

	private requireSession(): FreshSignInSession {
		const session = this.freshSignIn.sessionFor('passkeys')
		if (!session) {
			throw new PasskeyRequestError(
				'unauthenticated',
				'no passkey-management session',
			)
		}
		return session
	}

	private async call(
		session: FreshSignInSession,
		url: string,
		init: RequestInit,
	): Promise<unknown> {
		let resp: Response
		try {
			resp = await fetch(url, {
				...init,
				headers: {
					...(init.headers as Record<string, string> | undefined),
					authorization: `Bearer ${session.accessToken}`,
				},
			})
		} catch (err) {
			throw new PasskeyRequestError('failed', `network error: ${String(err)}`)
		}
		if (resp.status === 401) {
			throw new PasskeyRequestError('unauthenticated', 'token rejected')
		}
		if (!resp.ok) {
			throw new PasskeyRequestError('failed', `HTTP ${resp.status}`)
		}
		const text = await resp.text()
		return text ? (JSON.parse(text) as unknown) : {}
	}
}
