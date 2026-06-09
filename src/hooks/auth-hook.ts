import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, lifecycleHooks, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'

/**
 * Global authentication lifecycle hook. Gates route loads on authentication
 * state ONLY — there is no onboarding step machine and no ordinal gating.
 *
 * Policy:
 *  - Authenticated users bypass all restrictions.
 *  - Public routes (`data.auth === false`) always load.
 *  - Guests (unauthenticated) get free roam across application routes (soft
 *    gate); account-only features are hidden at point of use per
 *    `guest-mode-access`, not blocked by navigation. A guest with no follows who
 *    lands on the dashboard sees an in-page empty-state CTA toward discovery
 *    rather than a guard redirect.
 */
@lifecycleHooks()
export class AuthHook implements ILifecycleHooks<IRouteViewModel, 'canLoad'> {
	private readonly authService = resolve(IAuthService)

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		// Public routes (Welcome, About, auth callback, legal, discovery, etc.)
		// skip the auth-readiness barrier and always load.
		if (next.data?.auth === false) {
			return true
		}

		// Await auth readiness so downstream route VMs observe a resolved auth
		// state, then allow. Authenticated users and guests alike get free roam
		// (account-only features are hidden at point of use per guest-mode-access);
		// there is no onboarding-ordinal gating.
		await this.authService.ready
		return true
	}
}
