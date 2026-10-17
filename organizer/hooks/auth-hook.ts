import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, ILogger, lifecycleHooks, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import {
	savePendingReturn,
	takePendingReturn,
} from '../adapter/storage/pending-return-storage'
import { IConsoleLanguage } from '../i18n/console-language'
import { ILoginHint } from '../services/login-hint'
import { enforceIntendedOrg } from './org-enforcement'
import { hasOwnerRole } from './roles'

/**
 * Organizer console route guard (design D2). Two gates, in order:
 *
 *   1. **Authentication** — unauthenticated visitors are sent into the Zitadel
 *      sign-in flow (`authService.signIn()`), which redirects the whole
 *      document away, so the guard returns `false` to abort the in-app nav.
 *      A sign-in always names the Organizer's Organization (design D4 of
 *      `reuse-fan-email-for-organizer-sign-in`): when neither the address nor
 *      the device names one, no sign-in starts and the visitor is sent to the
 *      find-organizer screen, with the address they opened remembered so the
 *      sign-in link from the email returns them to it. The OIDC callback and
 *      find-organizer routes opt out via `data: { auth: false }`.
 *   2. **Authorization** — unlike the admin console (where org-scoped login is
 *      itself the wall), any tenant-org account authenticates successfully, so
 *      the guard inspects the `organizer-console` project roles claim and
 *      admits only operators holding `owner`. A signed-in account without the
 *      role is routed to the `denied` placeholder. The backend remains the
 *      source of truth for authorization; this guard is a UX gate.
 *
 * A route may opt out of the role check with `data: { role: false }` (the
 * `denied` placeholder itself, which must render for a signed-in non-owner).
 */
@lifecycleHooks()
export class OrganizerAuthHook
	implements ILifecycleHooks<IRouteViewModel, 'canLoad'>
{
	private readonly authService = resolve(IAuthService)
	private readonly config = resolve(IAppConfig)
	private readonly loginHint = resolve(ILoginHint)
	private readonly language = resolve(IConsoleLanguage)
	private readonly logger = resolve(ILogger).scopeTo('OrganizerAuthHook')

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		// The callback route is the sole unauthenticated route: it completes the
		// code exchange that establishes the session in the first place.
		if (next.data?.auth === false) {
			return true
		}

		await this.authService.ready

		if (!this.authService.isAuthenticated) {
			// Not signed in — start the OIDC redirect and abort the in-app nav. The
			// browser navigates away to Zitadel, so no organizer content renders.
			// Pass login_hint when present (invitation link, first sign-in) so
			// Zitadel pre-fills the operator's email address (design D5).
			const opened = `${window.location.pathname}${window.location.search}`
			if (!this.namesOrganization) {
				// A sign-in naming no Organization resolves to the person's fan
				// account, so none starts: the visitor asks for sign-in links.
				this.logger.info('No Organization known; opening find-organizer')
				if (window.location.pathname !== '/') savePendingReturn(opened)
				return '/find-organizer'
			}
			this.logger.info('Unauthenticated organizer access; starting sign-in')
			// After sign-in the operator returns to the address they opened, or,
			// arriving on `/` through a sign-in link, to the address they opened
			// before asking for the link.
			const pending =
				window.location.pathname === '/' ? takePendingReturn() : null
			await this.authService.signIn({
				...(this.loginHint ? { loginHint: this.loginHint } : {}),
				returnTo: pending ?? opened,
				// The hosted login opens in the language the console shows.
				uiLocales: this.language.current,
			})
			return false
		}

		// Authenticated. Routes flagged `role: false` (the denied placeholder)
		// skip the remaining checks so a signed-in non-owner still sees an
		// explanation rather than bouncing in a redirect loop.
		if (next.data?.role === false) {
			return true
		}

		// Enforce the authenticated session is the INTENDED tenant (design D-D).
		// This must be in the guard, not only the callback: a pre-existing console
		// session for a different org is admitted here WITHOUT a fresh OIDC
		// exchange (no callback), so a callback-only check would miss it and
		// silently onboard the wrong operator.
		const gate = await enforceIntendedOrg(
			this.authService,
			this.config.zitadelOrgId ?? this.config.zitadelOrgPrimaryDomain,
			this.authService.user?.profile as Record<string, unknown> | undefined,
			this.logger,
			this.language.current,
		)
		if (gate === 'reauth') {
			// Re-auth started; the browser navigates to Zitadel — abort in-app nav.
			return false
		}
		if (gate === 'denied') {
			this.logger.info(
				'Still signed in to a different org after re-auth; denying',
			)
			return '/denied'
		}

		if (hasOwnerRole(this.authService.user?.profile)) {
			return true
		}

		this.logger.info(
			'Authenticated without owner role; denying organizer access',
		)
		return '/denied'
	}

	/** Whether the address or the device names the Organization to sign in to. */
	private get namesOrganization(): boolean {
		return !!(this.config.zitadelOrgId || this.config.zitadelOrgPrimaryDomain)
	}
}
