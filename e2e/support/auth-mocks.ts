import type { Page } from '@playwright/test'

/**
 * OIDC issuer the app points at via `public/config.json` (`zitadelIssuer`).
 *
 * On boot the frontend constructs oidc-client-ts's `UserManager` from that
 * config and fetches the issuer's OIDC discovery document. When the dev
 * environment is intentionally offline that fetch fails and the app never
 * finishes bootstrapping, so every authenticated E2E times out waiting for the
 * app shell. Stubbing the discovery (+ related) endpoints makes each run
 * self-contained and independent of a live auth server.
 *
 * MUST match `public/config.json` (`zitadelIssuer`). Generalized from the
 * previously per-spec stub in `artist-image-ui.spec.ts`.
 */
export const OIDC_AUTHORITY = 'https://auth.dev.liverty-music.app'

/**
 * Route-stub the OIDC endpoints so the app boots without a live auth server.
 * Registered before navigation (via the shared `test` fixture), so it applies
 * to the very first bootstrap fetch. Specs still seed their own fake OIDC user
 * / RPC responses; this only removes the live-auth dependency.
 */
export async function installAuthMocks(page: Page): Promise<void> {
	await page.route(
		`${OIDC_AUTHORITY}/.well-known/openid-configuration`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					issuer: OIDC_AUTHORITY,
					authorization_endpoint: `${OIDC_AUTHORITY}/oauth/v2/authorize`,
					token_endpoint: `${OIDC_AUTHORITY}/oauth/v2/token`,
					userinfo_endpoint: `${OIDC_AUTHORITY}/oidc/v1/userinfo`,
					end_session_endpoint: `${OIDC_AUTHORITY}/oidc/v1/end_session`,
					jwks_uri: `${OIDC_AUTHORITY}/oauth/v2/keys`,
				}),
			}),
	)

	// Benign stubs so a lazy metadata / userinfo fetch (e.g. on renew or
	// signout) never reaches the offline auth server.
	await page.route(`${OIDC_AUTHORITY}/oauth/v2/keys`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: '{"keys":[]}',
		}),
	)
	await page.route(`${OIDC_AUTHORITY}/oidc/v1/userinfo`, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: '{"sub":"test-user-123"}',
		}),
	)
}
