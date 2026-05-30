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
import { Snack } from '../components/snack-bar/snack'
import { IAuthService } from '../services/auth-service'
import {
	DASHBOARD_FOLLOW_TARGET,
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
			// Nav tap on Dashboard after progression condition met (coach mark may have faded)
			if (
				routeStep === OnboardingStep.DASHBOARD &&
				this.onboarding.readyForDashboard
			) {
				this.onboarding.setStep(OnboardingStep.DASHBOARD)
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
			// Blocked: redirect to the current step, but always explain why —
			// no guard-initiated redirect during onboarding is a silent no-op.
			this.publishBlockedFeedback(routeStep)
			return (
				STEP_ROUTE_MAP[this.onboarding.currentStep as OnboardingStepValue] || ''
			)
		}

		// Priority 2.5: Onboarding user on a route without onboardingStep
		if (routeStep === undefined && this.onboarding.isOnboarding) {
			// Early-unlocked routes (e.g. Settings) are reachable from the discovery
			// step onward so the auth-entry and language controls are available
			// without completing onboarding.
			if (next.data?.earlyUnlock === true) {
				return true
			}
			this.publishBlockedFeedback(undefined)
			return this.onboarding.getRouteForCurrentStep()
		}

		// Priority 3: Completed onboarding (guest) — free roam. Account-only
		// features are hidden at point of use rather than navigation-blocked.
		if (this.onboarding.isCompleted) {
			return true
		}

		// Priority 4: Onboarding route accessed without active onboarding — redirect to LP
		if (routeStep !== undefined && next.data?.auth === false) {
			return ''
		}

		// Priority 5: Not authenticated, not in onboarding
		this.ea.publish(new Snack(this.i18n.tr('auth.loginRequired'), 'warning'))
		return ''
	}

	/**
	 * Publish contextual feedback when the guard blocks an onboarding navigation,
	 * so a blocked nav tap is never a silent no-op.
	 */
	private publishBlockedFeedback(
		routeStep: OnboardingStepValue | undefined,
	): void {
		// Dashboard tapped before the progression threshold — show how many more
		// follows unlock the timetable.
		if (
			routeStep === OnboardingStep.DASHBOARD &&
			this.onboarding.currentStep === OnboardingStep.DISCOVERY
		) {
			const remaining = Math.max(
				1,
				DASHBOARD_FOLLOW_TARGET - this.onboarding.followedCount,
			)
			this.ea.publish(
				new Snack(
					this.i18n.tr('auth.lockedDashboard', { count: remaining }),
					'info',
				),
			)
			return
		}
		this.ea.publish(new Snack(this.i18n.tr('auth.lockedGeneric'), 'info'))
	}
}
