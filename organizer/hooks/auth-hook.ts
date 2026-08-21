import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, ILogger, lifecycleHooks, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'
import { ILoginHint } from '../services/login-hint'
import { hasOwnerRole } from './roles'

/**
 * Organizer console route guard (design D2). Two gates, in order:
 *
 *   1. **Authentication** — unauthenticated visitors are sent into the Zitadel
 *      sign-in flow (`authService.signIn()`), which redirects the whole
 *      document away, so the guard returns `false` to abort the in-app nav. The
 *      OIDC callback route opts out via `data: { auth: false }` so the code
 *      exchange can run before a session exists.
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
	private readonly loginHint = resolve(ILoginHint)
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
			this.logger.info('Unauthenticated organizer access; starting sign-in')
			await this.authService.signIn(
				this.loginHint ? { loginHint: this.loginHint } : undefined,
			)
			return false
		}

		// Authenticated. Routes flagged `role: false` (the denied placeholder)
		// skip the role check so a signed-in non-owner still sees an explanation
		// rather than bouncing in a redirect loop.
		if (next.data?.role === false) {
			return true
		}

		if (hasOwnerRole(this.authService.user?.profile)) {
			return true
		}

		this.logger.info(
			'Authenticated without owner role; denying organizer access',
		)
		return '/denied'
	}
}
