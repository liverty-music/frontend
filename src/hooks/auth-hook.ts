import { I18N } from '@aurelia/i18n'
import type {
	IRouteViewModel,
	NavigationInstruction,
	Params,
	RouteNode,
} from '@aurelia/router'
import {
	IEventAggregator,
	type ILifecycleHooks,
	lifecycleHooks,
	resolve,
} from 'aurelia'
import { Toast } from '../components/toast-notification/toast'
import { IAuthService } from '../services/auth-service'
import {
	IOnboardingService,
	OnboardingStep,
	type OnboardingStepValue,
	STEP_ROUTE_MAP,
	stepIndex,
} from '../services/onboarding-service'

@lifecycleHooks()
export class AuthHook implements ILifecycleHooks<IRouteViewModel, 'canLoad'> {
	private readonly authService = resolve(IAuthService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

	async canLoad(
		_vm: IRouteViewModel,
		_params: Params,
		next: RouteNode,
		_current: RouteNode | null,
	): Promise<boolean | NavigationInstruction> {
		const routeStep = next.data?.onboardingStep as
			| OnboardingStepValue
			| undefined

		// Public routes without onboardingStep (LP, about, auth/callback) always allowed
		if (next.data?.auth === false && routeStep === undefined) {
			return true
		}

		await this.authService.ready

		// Priority 1: Authenticated users bypass all restrictions
		if (this.authService.isAuthenticated) {
			return true
		}

		// Priority 2: During onboarding, allow routes that match the current step
		if (routeStep !== undefined && this.onboarding.isOnboarding) {
			if (stepIndex(this.onboarding.currentStep) >= stepIndex(routeStep)) {
				return true
			}
			// Direct nav tap on Dashboard while coach mark is active — advance step
			if (
				routeStep === OnboardingStep.DASHBOARD &&
				this.onboarding.spotlightActive
			) {
				this.onboarding.deactivateSpotlight()
				this.onboarding.setStep(OnboardingStep.DASHBOARD)
				return true
			}
			// Redirect to the route for the current step
			return (
				STEP_ROUTE_MAP[this.onboarding.currentStep as OnboardingStepValue] || ''
			)
		}

		// Priority 2.5: Onboarding user on a route without onboardingStep — redirect silently
		if (routeStep === undefined && this.onboarding.isOnboarding) {
			return this.onboarding.getRouteForCurrentStep()
		}

		// Priority 3: Onboarding route accessed without active onboarding — redirect to LP
		if (routeStep !== undefined && next.data?.auth === false) {
			return ''
		}

		// Priority 4: Not authenticated, not in onboarding
		this.ea.publish(new Toast(this.i18n.tr('auth.loginRequired'), 'warning'))
		return ''
	}
}
