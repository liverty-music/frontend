import type { Locator, Page, Route } from '@playwright/test'
import { OIDC_AUTHORITY } from './auth-mocks'
import { artistList, organizer } from './organizer-data'

/**
 * Boots the organizer console on the dev server with a signed-in owner and
 * mocked organizer RPCs, so functional specs need neither a live auth server
 * nor a backend.
 *
 * - Every document request is answered with `organizer.html`, so a deep
 *   address such as `/organizers/org-1/artists/a-1/series` opens the console (the dev server would
 *   otherwise serve the fan app's `index.html`).
 * - `/config.json` is the organizer's runtime config.
 * - The OIDC user is seeded in localStorage with the `owner` project role.
 * - Organizer RPCs (Connect JSON) are answered from `rpc`; an RPC without an
 *   entry answers `{}` (an empty message), except the shell's two reads: the
 *   Organizer is XX Records (`org-1`) and it represents Band A (`a-1`) unless
 *   the spec answers `OrganizerService/Get` or `ArtistService/List` itself.
 */

/** The e2e Organizer (`organizer()`, id `org-1`) as console addresses name it. */
export const ORG = '/organizers/org-1'

/** Concerts of Band A (`a-1`), the Artist the e2e Organizer represents. */
export const SERIES = `${ORG}/artists/a-1/series`

/** The shell's reads every console screen makes. */
const SHELL_RPC: RpcMocks = {
	'OrganizerService/Get': organizer(),
	'ArtistService/List': artistList('Band A'),
}

const DEV_ORIGIN = 'http://localhost:9000'

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
	/**
	 * Origin the console is served from: the dev server by default, the
	 * production preview server for the `prod-build` checks.
	 */
	origin?: string
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
	const origin = options.origin ?? DEV_ORIGIN

	await page.route(
		(url) => url.origin === origin,
		async (route: Route) => {
			if (route.request().resourceType() !== 'document') {
				return route.fallback()
			}
			const response = await route.fetch({
				url: `${origin}/organizer.html`,
			})
			return route.fulfill({ response })
		},
	)

	await page.route(`${origin}/config.json`, (route) =>
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

		const answer = options.rpc?.[key] ?? SHELL_RPC[key]
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
	const origin = state.origins.find((o) => o.origin === DEV_ORIGIN)
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

/**
 * A console confirmation dialog with its body. The `<dialog>` is in the
 * shadow root of `<confirm-dialog>`, and the body is the page's own content
 * shown through the dialog's slot. A locator scopes by the DOM tree, where the
 * body is a child of the host, not of the `<dialog>`; scoping to the host
 * finds both the dialog's buttons and the body's text and checkboxes.
 */
export function confirmDialog(
	page: Page,
	options: { name?: string | RegExp } = {},
): Locator {
	return page
		.locator('confirm-dialog')
		.filter({ has: page.getByRole('dialog', options) })
}

/**
 * The console time field labelled `label` within `scope`: a group of an hour
 * and a minute select on a 24-hour clock, marked JST (design D19). A required
 * field's name also carries its asterisk and 必須.
 */
export function timeField(scope: Page | Locator, label: string): Locator {
	return scope.getByRole('group', { name: label })
}

/** Chooses `HH:mm` in the time field labelled `label` within `scope`. */
export async function chooseTime(
	scope: Page | Locator,
	label: string,
	hhmm: string,
): Promise<void> {
	const [hour, minute] = hhmm.split(':')
	const field = timeField(scope, label)
	await field.getByRole('combobox', { name: /時|Hour/ }).selectOption(hour)
	await field.getByRole('combobox', { name: /分|Minute/ }).selectOption(minute)
}

/** The `HH:mm` the time field labelled `label` within `scope` shows. */
export async function shownTime(
	scope: Page | Locator,
	label: string,
): Promise<string> {
	const field = timeField(scope, label)
	const hour = await field
		.getByRole('combobox', { name: /時|Hour/ })
		.inputValue()
	const minute = await field
		.getByRole('combobox', { name: /分|Minute/ })
		.inputValue()
	return hour && minute ? `${hour}:${minute}` : ''
}
