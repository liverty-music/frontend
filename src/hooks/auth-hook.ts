import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, lifecycleHooks, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { IToastService } from '../components/toast-notification/toast-notification'

@lifecycleHooks()
export class AuthHook
	implements ILifecycleHooks<IRouteViewModel, 'canLoad'>
{
	private readonly authService = resolve(IAuthService)
	private readonly toastService = resolve(IToastService)

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		if (next.data?.auth === false) {
			return true
		}

		await this.authService.ready

		if (!this.authService.isAuthenticated) {
			this.toastService.show('ログインが必要です')
			return ''
		}

		return true
	}
}
