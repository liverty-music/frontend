import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import { type ILifecycleHooks, lifecycleHooks, resolve } from 'aurelia'
import { IToastService } from '../components/toast-notification/toast-notification'
import { IAuthService } from '../services/auth-service'
import {
	IOnboardingService,
	type OnboardingStepValue,
	STEP_ROUTE_MAP,
} from '../services/onboarding-service'

@lifecycleHooks()
export class AuthHook implements ILifecycleHooks<IRouteViewModel, 'canLoad'> {
	private readonly authService = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly toastService = resolve(IToastService)

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		// Public routes (LP, about, auth/callback) always allowed
		if (next.data?.auth === false) {
			return true
		}

		await this.authService.ready

		// Priority 1: Authenticated users bypass all restrictions
		if (this.authService.isAuthenticated) {
			return true
		}

		// Priority 2: During tutorial, allow routes that match the current step
		const tutorialStep = next.data?.tutorialStep as number | undefined
		if (tutorialStep !== undefined && this.onboarding.isOnboarding) {
			if (this.onboarding.currentStep >= tutorialStep) {
				return true
			}
			// Redirect to the route for the current step
			return (
				STEP_ROUTE_MAP[this.onboarding.currentStep as OnboardingStepValue] || ''
			)
		}

		// Priority 3: Not authenticated, not in tutorial
		this.toastService.show('ログインが必要です', 'warning')
		return ''
	}
}
