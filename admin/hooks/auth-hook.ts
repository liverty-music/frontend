import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, ILogger, lifecycleHooks, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Admin route guard. Every admin route requires an authenticated session by
 * default; the only exception is the OIDC callback route, which is marked
 * `data: { auth: false }` so the code exchange can run pre-session.
 *
 * Unauthenticated visitors are sent straight into the Zitadel sign-in flow
 * (`authService.signIn()`), which redirects the whole document away — so the
 * guard returns `false` to abort the in-app navigation while the browser
 * leaves for the IdP. Because the admin OIDC settings carry the admin org id
 * in the `urn:zitadel:iam:org:id:<id>` scope (built by the shared AuthService
 * from `config.zitadelOrgId`), authentication itself is the access boundary:
 * only Google Workspace accounts in the admin org can complete the flow.
 */
@lifecycleHooks()
export class AdminAuthHook
	implements ILifecycleHooks<IRouteViewModel, 'canLoad'>
{
	private readonly authService = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('AdminAuthHook')

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		// The callback route is the sole unguarded route: it completes the code
		// exchange that establishes the session in the first place.
		if (next.data?.auth === false) {
			return true
		}

		await this.authService.ready

		if (this.authService.isAuthenticated) {
			return true
		}

		// Not signed in — start the OIDC redirect and abort the in-app nav. The
		// browser navigates away to Zitadel, so no admin content renders.
		this.logger.info('Unauthenticated admin access; starting sign-in flow')
		await this.authService.signIn()
		return false
	}
}
